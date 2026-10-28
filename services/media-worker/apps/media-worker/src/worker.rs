//! Job handlers: optimization and classification. Each handler is
//! idempotent (safe re-run), bounded in memory, and keeps the original
//! object separate from optimized outputs.

use std::path::PathBuf;
use std::sync::Arc;

use media_classification::{ClassificationOutcome, ClassificationService, ModerationDecision};
use media_processing::{
    decode_image, encode_image_renditions, image_rendition_names, transcode_renditions,
    verify_roundtrip, video_rendition_names, ProcessingError,
};
use mongodb::bson::doc;
use mongodb::bson::oid::ObjectId;

use crate::jobs::{fingerprint, ClaimOutcome, CompleteOutcome, Repos};
use crate::queue::JobQueue;
use crate::s3::MediaStore;

pub struct Worker {
    repos: Repos,
    queue: JobQueue,
    store: MediaStore,
    classifier: Option<Arc<ClassificationService>>,
    worker_id: String,
    shutdown: tokio_util::sync::CancellationToken,
}

impl Worker {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        repos: Repos,
        queue: JobQueue,
        store: MediaStore,
        classifier: Option<Arc<ClassificationService>>,
        shutdown: tokio_util::sync::CancellationToken,
    ) -> Self {
        Self {
            repos,
            queue,
            store,
            classifier,
            worker_id: format!("media-worker-{}", uuid::Uuid::new_v4()),
            shutdown,
        }
    }

    /// Consumer loop: acquire a concurrency permit BEFORE popping so the
    /// queue backlog cannot balloon memory.
    pub async fn run(&self) -> anyhow::Result<()> {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(
            self.repos.config.max_concurrent_jobs,
        ));
        let mut task_set: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();

        loop {
            if self.shutdown.is_cancelled() {
                break;
            }

            let permit = match semaphore.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break, // semaphore closed: shutting down
            };

            let raw = match self.queue.pop(5).await? {
                Some(raw) => raw,
                None => {
                    drop(permit);
                    continue;
                }
            };

            let repos = self.repos.clone();
            let queue = self.queue.clone();
            let store = self.store.clone();
            let classifier = self.classifier.clone();
            let worker_id = self.worker_id.clone();
            let shutdown = self.shutdown.clone();

            task_set.spawn(async move {
                let _permit = permit;
                if shutdown.is_cancelled() {
                    // Put it back so the next run processes it.
                    if let Err(e) = queue.ack(&raw).await {
                        tracing::warn!("ack during shutdown failed: {e}");
                    }
                    return;
                }
                match handle_raw(&repos, &queue, &store, classifier, &worker_id, &raw).await {
                    Ok(()) => {}
                    Err(e) => {
                        tracing::error!(error = %e, "unexpected job handling error");
                    }
                }
            });
        }

        // Graceful shutdown: wait for in-flight jobs to finish.
        while task_set.join_next().await.is_some() {}
        Ok(())
    }
}

async fn handle_raw(
    repos: &Repos,
    queue: &JobQueue,
    store: &MediaStore,
    classifier: Option<Arc<ClassificationService>>,
    worker_id: &str,
    raw: &str,
) -> anyhow::Result<()> {
    let payload = match crate::jobs::parse_payload(raw) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(raw, error = %e, "malformed job payload; acking poison message");
            queue.ack(raw).await?;
            return Ok(());
        }
    };

    let job_oid = match ObjectId::parse_str(&payload.job_id) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(job = %payload.job_id, error = %e, "bad job id; acking");
            queue.ack(raw).await?;
            return Ok(());
        }
    };
    let media_oid = match ObjectId::parse_str(&payload.media_id) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(job = %payload.job_id, error = %e, "bad media id; acking");
            queue.ack(raw).await?;
            return Ok(());
        }
    };

    let claimed = match repos.claim_job(&job_oid, worker_id).await? {
        ClaimOutcome::Claimed(doc) => doc,
        ClaimOutcome::Skipped => {
            tracing::info!(job = %payload.job_id, "job not claimable, acking");
            queue.ack(raw).await?;
            return Ok(());
        }
    };

    let lock_token = claimed.get_str("lockToken").unwrap_or_default().to_string();
    let job_type = claimed.get_str("jobType").unwrap_or_default().to_string();

    let result = match job_type.as_str() {
        "OPTIMIZE_IMAGE" => optimize_image(repos, store, &media_oid, &job_oid).await,
        "CLASSIFY_IMAGE" => classify_image(repos, store, classifier, &media_oid, &job_oid).await,
        "GENERATE_VIDEO_RENDITIONS" => {
            generate_video_renditions(repos, store, &media_oid, &job_oid).await
        }
        other => {
            tracing::warn!(job_type = other, "unknown job type; failing permanently");
            repos
                .fail_job(&job_oid, &lock_token, "unknown job type", false)
                .await?;
            queue.ack(raw).await?;
            return Ok(());
        }
    };

    match result {
        Ok(()) => match repos.complete_job(&job_oid, &lock_token).await {
            Ok(CompleteOutcome::Completed) => {}
            Ok(CompleteOutcome::LeaseLost) => {
                tracing::warn!(job = %payload.job_id, "lease lost during completion");
            }
            Err(e) => {
                tracing::error!(job = %payload.job_id, error = %e, "complete_job failed");
            }
        },
        Err(JobFailure::Retryable(message)) => {
            tracing::warn!(job = %payload.job_id, message, "retryable failure");
            repos
                .fail_job(&job_oid, &lock_token, &message, true)
                .await?;
        }
        Err(JobFailure::Permanent(message)) => {
            tracing::error!(job = %payload.job_id, message, "permanent failure");
            repos
                .fail_job(&job_oid, &lock_token, &message, false)
                .await?;
        }
    }

    queue.ack(raw).await?;
    Ok(())
}

enum JobFailure {
    /// Retry with backoff — infrastructure or transient dependency issues.
    Retryable(String),
    /// Bad file or policy rejection — do not retry.
    Permanent(String),
}

fn rendition_key(raw_key: &str, rendition: &str) -> String {
    // .../{mediaId}/raw -> .../{mediaId}/optimized/{rendition}
    match raw_key.strip_suffix("/raw") {
        Some(prefix) => format!("{prefix}/optimized/{rendition}"),
        None => format!("{raw_key}/optimized/{rendition}"),
    }
}

/// OPTIMIZE_IMAGE: claim -> read raw -> validate/decode with limits ->
/// orientation + metadata strip (via re-encode) -> renditions -> S3 -> DB.
/// Original object is left untouched under `/raw`.
async fn optimize_image(
    repos: &Repos,
    store: &MediaStore,
    media_oid: &ObjectId,
    _job_oid: &ObjectId,
) -> Result<(), JobFailure> {
    let media = load_media(repos, media_oid).await?;

    // Idempotency: already processed with the expected renditions — skip work.
    let raw_key = media
        .get_str("key")
        .map_err(|_| JobFailure::Permanent("media document missing key".into()))?
        .to_string();
    let expected = image_rendition_names();
    if media.get_str("processingStatus").ok() == Some("DONE")
        && expected.iter().all(|n| {
            media
                .get_document("variants")
                .ok()
                .and_then(|v| v.get_str(n).ok().map(str::to_string))
                .is_some_and(|k| k == rendition_key(&raw_key, n))
        })
    {
        tracing::info!(media = %media_oid, "renditions already present; skipping");
        return Ok(());
    }

    let raw_bytes = store
        .get(&raw_key)
        .await
        .map_err(|e| JobFailure::Retryable(format!("s3 get {raw_key}: {e}")))?;

    // Validate + decode with resource limits. Corrupt/oversized is a FILE
    // defect -> reject (permanent), not a retry.
    let decoded = decode_image(&raw_bytes).map_err(|e| match e {
        ProcessingError::Decode(m) | ProcessingError::TooLarge(m) => {
            JobFailure::Permanent(format!("invalid image: {m}"))
        }
        other => JobFailure::Retryable(other.to_string()),
    })?;

    let renditions = encode_image_renditions(&decoded.image)
        .map_err(|e| JobFailure::Retryable(format!("encode: {e}")))?;

    for (name, bytes) in &renditions {
        verify_roundtrip(bytes).map_err(|e| JobFailure::Retryable(format!("{name}: {e}")))?;
    }

    let mut variant_keys: Vec<(String, String)> = Vec::with_capacity(renditions.len());
    for (name, bytes) in &renditions {
        let key = rendition_key(&raw_key, name);
        store
            .put(&key, bytes, "image/webp")
            .await
            .map_err(|e| JobFailure::Retryable(format!("s3 put {key}: {e}")))?;
        variant_keys.push(((*name).to_string(), key));
    }

    repos
        .set_media_processed(media_oid, &variant_keys, &fingerprint(&raw_bytes))
        .await
        .map_err(|e| JobFailure::Retryable(format!("db update: {e}")))?;

    tracing::info!(
        media = %media_oid,
        renditions = %variant_keys.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(","),
        "image optimized"
    );
    Ok(())
}

/// GENERATE_VIDEO_RENDITIONS: FFmpeg CLI in a bounded scratch dir.
async fn generate_video_renditions(
    repos: &Repos,
    store: &MediaStore,
    media_oid: &ObjectId,
    _job_oid: &ObjectId,
) -> Result<(), JobFailure> {
    let media = load_media(repos, media_oid).await?;
    let raw_key = media
        .get_str("key")
        .map_err(|_| JobFailure::Permanent("media document missing key".into()))?
        .to_string();

    // Idempotency: all renditions already uploaded -> skip.
    let expected = video_rendition_names();
    if media.get_str("processingStatus").ok() == Some("DONE")
        && expected.iter().all(|n| {
            media
                .get_document("variants")
                .ok()
                .and_then(|v| v.get_str(n).ok().map(str::to_string))
                .is_some_and(|k| k == rendition_key(&raw_key, n))
        })
    {
        tracing::info!(media = %media_oid, "video renditions already present; skipping");
        return Ok(());
    }

    let raw_bytes = store
        .get(&raw_key)
        .await
        .map_err(|e| JobFailure::Retryable(format!("s3 get {raw_key}: {e}")))?;

    let scratch_root = PathBuf::from(repos.config.scratch_dir.clone());
    let work_dir = scratch_root.join(media_oid.to_string());
    let input_path = work_dir.join("source.mp4");
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|e| JobFailure::Retryable(format!("scratch dir: {e}")))?;
    tokio::fs::write(&input_path, &raw_bytes)
        .await
        .map_err(|e| JobFailure::Retryable(format!("write scratch: {e}")))?;

    let outputs = transcode_renditions(&input_path, &work_dir)
        .await
        .map_err(|e| {
            if e.is_file_defect() {
                JobFailure::Permanent(format!("invalid video: {e}"))
            } else {
                JobFailure::Retryable(format!("transcode: {e}"))
            }
        })?;

    let mut variant_keys = Vec::with_capacity(outputs.len());
    for (name, path) in outputs {
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| JobFailure::Retryable(format!("read rendition: {e}")))?;
        let key = rendition_key(&raw_key, &name);
        store
            .put(&key, &bytes, "video/mp4")
            .await
            .map_err(|e| JobFailure::Retryable(format!("s3 put {key}: {e}")))?;
        variant_keys.push((name.to_string(), key));
        let _ = tokio::fs::remove_file(&path).await;
    }

    repos
        .set_media_processed(media_oid, &variant_keys, &fingerprint(&raw_bytes))
        .await
        .map_err(|e| JobFailure::Retryable(format!("db update: {e}")))?;

    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    tracing::info!(media = %media_oid, "video renditions generated");
    Ok(())
}

/// CLASSIFY_IMAGE: idempotency pre-check on (mediaId, pipelineVersion,
/// sourceFingerprint) -> fetch eligible image -> Vision -> normalize ->
/// store + moderation status. Provider outage = retryable; ambiguous
/// content = REVIEW_REQUIRED (never auto-reject); corrupt file = reject.
async fn classify_image(
    repos: &Repos,
    store: &MediaStore,
    classifier: Option<Arc<ClassificationService>>,
    media_oid: &ObjectId,
    _job_oid: &ObjectId,
) -> Result<(), JobFailure> {
    let Some(classifier) = classifier else {
        // No API key configured: not a media problem. Retryable so the job
        // eventually completes once credentials are provided.
        return Err(JobFailure::Retryable(
            "classification not configured (GOOGLE_VISION_API_KEY missing)".into(),
        ));
    };

    let media = load_media(repos, media_oid).await?;
    let raw_key = media
        .get_str("key")
        .map_err(|_| JobFailure::Permanent("media document missing key".into()))?
        .to_string();

    // Eligible image: prefer the optimized rendition, fall back to raw.
    let (_source_key, source_bytes) = {
        let optimized = media
            .get_document("variants")
            .ok()
            .and_then(|v| v.get_str("webp-1200").ok().map(str::to_string));
        match optimized {
            Some(key) => {
                let bytes = store
                    .get(&key)
                    .await
                    .map_err(|e| JobFailure::Retryable(format!("s3 get {key}: {e}")))?;
                (key, bytes)
            }
            None => {
                let bytes = store
                    .get(&raw_key)
                    .await
                    .map_err(|e| JobFailure::Retryable(format!("s3 get {raw_key}: {e}")))?;
                (raw_key.clone(), bytes)
            }
        }
    };

    let source_fingerprint = fingerprint(&source_bytes);
    let pipeline_version = media_classification::CLASSIFICATION_PIPELINE_VERSION;

    // Step 2: a valid result for the same media version/config already
    // exists -> idempotent skip.
    if repos
        .find_classification(media_oid, pipeline_version, &source_fingerprint)
        .await
        .map_err(|e| JobFailure::Retryable(format!("db lookup: {e}")))?
        .is_some()
    {
        tracing::info!(media = %media_oid, "classification result already exists; skipping");
        return Ok(());
    }

    // Step 3 sanity: the analyzed bytes must decode (vision accepts what it
    // accepts, but corrupt files are a media defect, not a provider error).
    if let Err(e) = media_processing::image_dimensions(&source_bytes) {
        return Err(JobFailure::Permanent(format!("invalid image: {e}")));
    }

    // Steps 4-6: call Vision, normalize, store. Outage -> retryable; the
    // policy table forbids rejecting on API failure.
    let outcome: ClassificationOutcome = classifier.classify(&source_bytes).await.map_err(|e| {
        if e.is_retryable() {
            JobFailure::Retryable(format!("vision outage: {e}"))
        } else {
            JobFailure::Permanent(format!("vision config: {e}"))
        }
    })?;

    let labels_bson: mongodb::bson::Array = outcome
        .labels
        .iter()
        .map(|l| {
            mongodb::bson::Bson::Document(doc! {
                "name": l.name.clone(),
                "score": l.score,
                "providerLabel": l.provider_label.clone(),
            })
        })
        .collect();

    let categories: Vec<String> = outcome
        .labels
        .iter()
        .filter(|l| l.score >= 0.80)
        .map(|l| l.name.clone())
        .collect();

    repos
        .upsert_classification(
            media_oid,
            outcome.provider,
            &outcome.pipeline_version,
            outcome.model_version.as_deref(),
            &source_fingerprint,
            labels_bson,
            categories,
        )
        .await
        .map_err(|e| JobFailure::Retryable(format!("db write: {e}")))?;

    // Apply the moderation policy to Media.moderationStatus.
    match &outcome.moderation {
        ModerationDecision::Approve { .. } => {
            repos
                .set_moderation_status(media_oid, "APPROVED", "classification clear pass")
                .await
                .map_err(|e| JobFailure::Retryable(format!("db update: {e}")))?;
        }
        ModerationDecision::Review { reason, .. } => {
            repos
                .set_moderation_status(media_oid, "REVIEW_REQUIRED", reason)
                .await
                .map_err(|e| JobFailure::Retryable(format!("db update: {e}")))?;
        }
        ModerationDecision::Reject { reason } => {
            // Clear policy violation: quarantine the media record.
            repos
                .set_moderation_status(media_oid, "REJECTED", reason)
                .await
                .map_err(|e| JobFailure::Retryable(format!("db update: {e}")))?;
        }
    }

    tracing::info!(
        media = %media_oid,
        labels = outcome.labels.iter().map(|l| l.name.as_str()).collect::<Vec<_>>().join(","),
        "classified"
    );
    Ok(())
}

async fn load_media(
    repos: &Repos,
    media_oid: &ObjectId,
) -> Result<mongodb::bson::Document, JobFailure> {
    repos
        .get_media(media_oid)
        .await
        .map_err(|e| JobFailure::Retryable(format!("db read media: {e}")))?
        .ok_or_else(|| JobFailure::Permanent("media record not found".into()))
}
