//! Job handlers: optimization and classification. Each handler is
//! idempotent (safe re-run), bounded in memory, and keeps the original
//! object separate from optimized outputs.
//!
//! # Lease heartbeat and cancellation
//!
//! After a successful claim, `handle_raw` starts one [`LeaseHeartbeat`] and
//! creates one cancellation token for the job. The heartbeat cancels that
//! token when it can no longer prove ownership; the handler is raced against
//! it (and against worker shutdown) and checks it before every externally
//! visible commit. Media and classification writes are additionally fenced by
//! `job_id` + `lock_token` in MongoDB, so a cancellation that arrives just
//! before a write still cannot produce a stale commit.
//!
//! # Attempt-scoped output keys
//!
//! Every execution uploads to:
//!
//! ```text
//! {raw key without trailing /raw}/optimized/{lockToken}/{rendition}
//! ```
//!
//! The lock token is an attempt-unique UUID, so a stale worker can leave
//! orphaned objects behind but can never overwrite the current attempt's
//! outputs. Only the fenced `Media` commit publishes a variant key. The raw
//! object under `/raw` is never touched.
//!
//! Cleanup is intentionally out of scope for this worker: a later sweeper must
//! delete `optimized/{token}/` prefixes that are no longer referenced by
//! `Media.variants`. This code does not implement deletion or promotion.

use std::path::PathBuf;
use std::sync::Arc;

use media_classification::{ClassificationOutcome, ClassificationService, ModerationDecision};
use media_processing::{
    decode_image, encode_image_renditions, image_rendition_names, transcode_renditions,
    verify_roundtrip, video_rendition_names, ProcessingError,
};
use mongodb::bson::{doc, oid::ObjectId, Document};
use tokio_util::sync::CancellationToken;

use crate::heartbeat::LeaseHeartbeat;
use crate::jobs::{
    fingerprint, ClaimOutcome, ClassificationCommit, CompleteOutcome, MediaCommitOutcome, Repos,
};
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
                match handle_raw(
                    &repos, &queue, &store, classifier, &worker_id, &raw, &shutdown,
                )
                .await
                {
                    Ok(()) => {}
                    Err(e) => {
                        tracing::error!(error = %e, "unexpected job handling error");
                    }
                }
            });
        }

        // Graceful shutdown: wait for in-flight jobs to finish. Their job
        // cancellation tokens are children of `shutdown`, so handlers and
        // heartbeats stop promptly rather than running to completion.
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
    shutdown: &CancellationToken,
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

    // One cancellation token per job. It is a child of worker shutdown, so
    // shutdown cancels both the handler and the heartbeat.
    let job_cancel = shutdown.child_token();
    let heartbeat = LeaseHeartbeat::start(
        repos.clone(),
        job_oid,
        lock_token.clone(),
        job_cancel.clone(),
    )
    .await;

    let handler = async {
        match job_type.as_str() {
            "OPTIMIZE_IMAGE" => {
                optimize_image(repos, store, &media_oid, &job_oid, &lock_token, &job_cancel).await
            }
            "CLASSIFY_IMAGE" => {
                classify_image(
                    repos,
                    store,
                    classifier.clone(),
                    &media_oid,
                    &job_oid,
                    &lock_token,
                    &job_cancel,
                )
                .await
            }
            "GENERATE_VIDEO_RENDITIONS" => {
                generate_video_renditions(
                    repos,
                    store,
                    &media_oid,
                    &job_oid,
                    &lock_token,
                    &job_cancel,
                )
                .await
            }
            other => {
                tracing::warn!(job_type = other, "unknown job type; failing permanently");
                Err(JobFailure::Permanent(format!("unknown job type: {other}")))
            }
        }
    };

    // Shutdown or a lost lease cancels the handler future immediately. The
    // handler also checks the token before each external side effect, but this
    // race is what stops long CPU/FFmpeg/S3 work promptly.
    let result = tokio::select! {
        biased;
        _ = job_cancel.cancelled() => Err(JobFailure::LeaseLost),
        result = handler => result,
    };

    // Stop and join the heartbeat on every path, before any terminal write.
    heartbeat.stop().await;

    match result {
        Ok(()) => {
            if job_cancel.is_cancelled() {
                tracing::warn!(
                    job = %payload.job_id,
                    "lease lost or shutdown before completion; not completing job"
                );
            } else {
                match repos.complete_job(&job_oid, &lock_token).await {
                    Ok(CompleteOutcome::Completed) => {}
                    Ok(CompleteOutcome::LeaseLost) => {
                        tracing::warn!(job = %payload.job_id, "lease lost during completion");
                    }
                    Err(e) => {
                        tracing::error!(job = %payload.job_id, error = %e, "complete_job failed");
                    }
                }
            }
        }
        Err(JobFailure::LeaseLost) => {
            if shutdown.is_cancelled() {
                tracing::info!(
                    job = %payload.job_id,
                    "worker shutdown cancelled job; leaving durable state for recovery"
                );
            } else {
                tracing::warn!(
                    job = %payload.job_id,
                    "lease lost; abandoning job without media commit or failure transition"
                );
            }
        }
        Err(JobFailure::Retryable(message)) => {
            if job_cancel.is_cancelled() {
                tracing::warn!(
                    job = %payload.job_id,
                    message,
                    "not recording retryable failure: worker no longer owns the lease"
                );
            } else {
                tracing::warn!(job = %payload.job_id, message, "retryable failure");
                repos
                    .fail_job(&job_oid, &lock_token, &message, true)
                    .await?;
            }
        }
        Err(JobFailure::Permanent(message)) => {
            if job_cancel.is_cancelled() {
                tracing::warn!(
                    job = %payload.job_id,
                    message,
                    "not recording permanent failure: worker no longer owns the lease"
                );
            } else {
                tracing::error!(job = %payload.job_id, message, "permanent failure");
                repos
                    .fail_job(&job_oid, &lock_token, &message, false)
                    .await?;
            }
        }
    }

    // Sequence 2 owns acknowledgement/drain semantics. Keep the existing ack
    // and rely on MongoDB lease recovery for abandoned work.
    queue.ack(raw).await?;
    Ok(())
}

enum JobFailure {
    /// The worker no longer owns the job (or is shutting down). Never retried
    /// as a media failure and never written to the job or Media.
    LeaseLost,
    /// Retry with backoff — infrastructure or transient dependency issues.
    Retryable(String),
    /// Bad file, unknown job type, or policy rejection — do not retry.
    Permanent(String),
}

fn ensure_active(cancel: &CancellationToken, job_id: &ObjectId) -> Result<(), JobFailure> {
    if cancel.is_cancelled() {
        tracing::warn!(job = %job_id, "cancelling job work before side effect: lease lost or shutdown");
        Err(JobFailure::LeaseLost)
    } else {
        Ok(())
    }
}

/// Attempt-scoped rendition key. See the module docs for the layout and the
/// deferred cleanup requirement.
fn attempt_rendition_key(raw_key: &str, rendition: &str, lock_token: &str) -> String {
    let prefix = raw_key.strip_suffix("/raw").unwrap_or(raw_key);
    format!("{prefix}/optimized/{}/{rendition}", attempt_id(lock_token))
}

/// Convert a lock token into an S3-safe path segment while preserving
/// uniqueness. Claim tokens are UUIDs and pass through unchanged; anything
/// that has to be sanitized gets a short deterministic hash suffix.
fn attempt_id(lock_token: &str) -> String {
    let cleaned: String = lock_token
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .take(96)
        .collect();

    if cleaned == lock_token && !cleaned.is_empty() {
        return cleaned;
    }

    let mut id = if cleaned.is_empty() {
        "attempt".to_string()
    } else {
        cleaned
    };
    let digest = fingerprint(lock_token.as_bytes());
    id.push('-');
    id.push_str(&digest[..8]);
    id
}

/// A completed media record is authoritative once every expected variant is
/// present. The exact key may belong to any prior attempt; the fenced commit
/// is what publishes the current attempt's keys.
fn has_expected_variants(media: &Document, expected: &[&str]) -> bool {
    if media.get_str("processingStatus").ok() != Some("DONE") {
        return false;
    }
    let Ok(variants) = media.get_document("variants") else {
        return false;
    };
    expected.iter().all(|name| variants.get_str(*name).is_ok())
}

/// OPTIMIZE_IMAGE: claim -> read raw -> validate/decode with limits ->
/// orientation + metadata strip (via re-encode) -> renditions -> S3 -> fenced
/// DB commit. Original object is left untouched under `/raw`.
async fn optimize_image(
    repos: &Repos,
    store: &MediaStore,
    media_oid: &ObjectId,
    job_oid: &ObjectId,
    lock_token: &str,
    cancel: &CancellationToken,
) -> Result<(), JobFailure> {
    ensure_active(cancel, job_oid)?;

    let media = load_media(repos, media_oid).await?;
    let raw_key = media
        .get_str("key")
        .map_err(|_| JobFailure::Permanent("media document missing key".into()))?
        .to_string();

    // Idempotency: already processed with the expected renditions — skip work.
    let expected = image_rendition_names();
    if has_expected_variants(&media, &expected) {
        tracing::info!(media = %media_oid, "renditions already present; skipping");
        return Ok(());
    }

    ensure_active(cancel, job_oid)?;
    let raw_bytes = store
        .get(&raw_key)
        .await
        .map_err(|e| JobFailure::Retryable(format!("s3 get {raw_key}: {e}")))?;

    // Validate + decode with resource limits. Corrupt/oversized is a FILE
    // defect -> reject (permanent), not a retry.
    ensure_active(cancel, job_oid)?;
    let decoded = decode_image(&raw_bytes).map_err(|e| match e {
        ProcessingError::Decode(m) | ProcessingError::TooLarge(m) => {
            JobFailure::Permanent(format!("invalid image: {m}"))
        }
        other => JobFailure::Retryable(other.to_string()),
    })?;

    ensure_active(cancel, job_oid)?;
    let renditions = encode_image_renditions(&decoded.image)
        .map_err(|e| JobFailure::Retryable(format!("encode: {e}")))?;

    ensure_active(cancel, job_oid)?;
    for (name, bytes) in &renditions {
        verify_roundtrip(bytes).map_err(|e| JobFailure::Retryable(format!("{name}: {e}")))?;
    }

    let mut variant_keys: Vec<(String, String)> = Vec::with_capacity(renditions.len());
    for (name, bytes) in &renditions {
        ensure_active(cancel, job_oid)?;
        let key = attempt_rendition_key(&raw_key, name, lock_token);
        store
            .put(&key, bytes, "image/webp")
            .await
            .map_err(|e| JobFailure::Retryable(format!("s3 put {key}: {e}")))?;
        variant_keys.push(((*name).to_string(), key));
    }

    // Fenced commit: only the live attempt can publish these variant keys.
    ensure_active(cancel, job_oid)?;
    let committed = repos
        .set_media_processed(
            job_oid,
            lock_token,
            media_oid,
            &variant_keys,
            &fingerprint(&raw_bytes),
        )
        .await
        .map_err(|e| JobFailure::Retryable(format!("db update: {e}")))?;

    if committed == MediaCommitOutcome::LeaseLost {
        return Err(JobFailure::LeaseLost);
    }

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
    job_oid: &ObjectId,
    lock_token: &str,
    cancel: &CancellationToken,
) -> Result<(), JobFailure> {
    ensure_active(cancel, job_oid)?;

    let media = load_media(repos, media_oid).await?;
    let raw_key = media
        .get_str("key")
        .map_err(|_| JobFailure::Permanent("media document missing key".into()))?
        .to_string();

    // Idempotency: all renditions already uploaded -> skip.
    let expected = video_rendition_names();
    if has_expected_variants(&media, &expected) {
        tracing::info!(media = %media_oid, "video renditions already present; skipping");
        return Ok(());
    }

    ensure_active(cancel, job_oid)?;
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

    ensure_active(cancel, job_oid)?;
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
        ensure_active(cancel, job_oid)?;
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| JobFailure::Retryable(format!("read rendition: {e}")))?;
        let key = attempt_rendition_key(&raw_key, name, lock_token);
        store
            .put(&key, &bytes, "video/mp4")
            .await
            .map_err(|e| JobFailure::Retryable(format!("s3 put {key}: {e}")))?;
        variant_keys.push((name.to_string(), key));
        let _ = tokio::fs::remove_file(&path).await;
    }

    ensure_active(cancel, job_oid)?;
    let committed = repos
        .set_media_processed(
            job_oid,
            lock_token,
            media_oid,
            &variant_keys,
            &fingerprint(&raw_bytes),
        )
        .await
        .map_err(|e| JobFailure::Retryable(format!("db update: {e}")))?;

    if committed == MediaCommitOutcome::LeaseLost {
        return Err(JobFailure::LeaseLost);
    }

    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    tracing::info!(media = %media_oid, "video renditions generated");
    Ok(())
}

/// CLASSIFY_IMAGE: idempotency pre-check on (mediaId, pipelineVersion,
/// sourceFingerprint) -> fetch eligible image -> Vision -> normalize ->
/// fenced classification + moderation commit. Provider outage = retryable;
/// ambiguous content = REVIEW_REQUIRED (never auto-reject); corrupt file =
/// reject.
async fn classify_image(
    repos: &Repos,
    store: &MediaStore,
    classifier: Option<Arc<ClassificationService>>,
    media_oid: &ObjectId,
    job_oid: &ObjectId,
    lock_token: &str,
    cancel: &CancellationToken,
) -> Result<(), JobFailure> {
    let Some(classifier) = classifier else {
        // No API key configured: not a media problem. Retryable so the job
        // eventually completes once credentials are provided.
        return Err(JobFailure::Retryable(
            "classification not configured (GOOGLE_VISION_API_KEY missing)".into(),
        ));
    };

    ensure_active(cancel, job_oid)?;
    let media = load_media(repos, media_oid).await?;
    let raw_key = media
        .get_str("key")
        .map_err(|_| JobFailure::Permanent("media document missing key".into()))?
        .to_string();

    // Eligible image: prefer the optimized rendition, fall back to raw.
    ensure_active(cancel, job_oid)?;
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
    ensure_active(cancel, job_oid)?;
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

    let (moderation_status, moderation_reason) = match &outcome.moderation {
        ModerationDecision::Approve { .. } => ("APPROVED", "classification clear pass".to_string()),
        ModerationDecision::Review { reason, .. } => ("REVIEW_REQUIRED", reason.clone()),
        ModerationDecision::Reject { reason } => ("REJECTED", reason.clone()),
    };

    ensure_active(cancel, job_oid)?;
    let committed = repos
        .upsert_classification(
            job_oid,
            lock_token,
            media_oid,
            &ClassificationCommit {
                provider: outcome.provider.to_string(),
                pipeline_version: outcome.pipeline_version.clone(),
                model_version: outcome.model_version.clone(),
                source_fingerprint,
                labels: labels_bson,
                categories,
                moderation_status: moderation_status.to_string(),
                moderation_reason,
            },
        )
        .await
        .map_err(|e| JobFailure::Retryable(format!("db write: {e}")))?;

    if committed == MediaCommitOutcome::LeaseLost {
        return Err(JobFailure::LeaseLost);
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

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, Bson};

    #[test]
    fn rendition_keys_are_attempt_scoped() {
        let raw = "media/u/1/p/2/m/raw";
        let first = attempt_rendition_key(raw, "webp-1200", "token-a");
        let second = attempt_rendition_key(raw, "webp-1200", "token-b");

        assert_eq!(first, "media/u/1/p/2/m/optimized/token-a/webp-1200");
        assert_eq!(second, "media/u/1/p/2/m/optimized/token-b/webp-1200");
        assert_ne!(first, second, "attempts must never share a key");
        assert_ne!(
            first, "media/u/1/p/2/m/optimized/webp-1200",
            "the unscoped key layout must not be produced"
        );
    }

    #[test]
    fn sanitized_tokens_remain_unique() {
        let raw = "media/u/1/p/2/m/raw";
        let first = attempt_rendition_key(raw, "mp4-720", "a/b");
        let second = attempt_rendition_key(raw, "mp4-720", "a?b");

        assert!(first.contains("/optimized/a"), "got {first}");
        assert_ne!(
            first, second,
            "sanitization must not collapse distinct tokens"
        );
        assert_eq!(first, attempt_rendition_key(raw, "mp4-720", "a/b"));
    }

    #[test]
    fn completed_media_with_all_variants_is_idempotent_regardless_of_token() {
        let media = doc! {
            "processingStatus": "DONE",
            "variants": {
                "webp-1200": "media/m/optimized/old-attempt/webp-1200",
                "webp-400": "media/m/optimized/old-attempt/webp-400",
            }
        };

        assert!(has_expected_variants(&media, &["webp-1200", "webp-400"]));
        assert!(!has_expected_variants(&media, &["webp-1200", "webp-800"]));

        let mut pending = media.clone();
        pending.insert("processingStatus", "PENDING");
        assert!(!has_expected_variants(&pending, &["webp-1200"]));

        let mut missing = doc! { "processingStatus": "DONE" };
        missing.insert("variants", Bson::Null);
        assert!(!has_expected_variants(&missing, &["webp-1200"]));
    }
}
