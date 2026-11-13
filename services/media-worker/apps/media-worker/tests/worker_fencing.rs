//! Black-box contract tests for lease renewal and lease-fenced commits.
//!
//! These tests use a real replica set because the worker relies on MongoDB
//! transaction and update semantics. They are `#[ignore]`d so the default
//! suite never needs Docker:
//!
//! ```text
//! TEST_MONGO_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0' \
//!   cargo test -p media-worker --test worker_fencing -- --ignored --test-threads=1
//! ```
//!
//! Every test uses a unique disposable database and drops it after asserting.
//! Loopback URIs are connected with `directConnection=true` so a Docker-hosted
//! replica set that advertises `mongo:27017` stays reachable from the host.

use std::sync::Arc;
use std::time::Duration;

use mongodb::bson::{doc, oid::ObjectId, Bson, DateTime as BsonDateTime, Document};
use mongodb::{Client, Database};
use tokio_util::sync::CancellationToken;

use media_worker::config::Config;
use media_worker::heartbeat::LeaseHeartbeat;
use media_worker::jobs::{
    ClaimOutcome, ClassificationCommit, CompleteOutcome, MediaCommitOutcome, Repos,
};

const DEFAULT_TEST_MONGO_URI: &str = "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const RETRY_BACKOFF_BASE_SECONDS: i64 = 30;
const RETRY_BACKOFF_MAX_SECONDS: i64 = 3600;

fn test_mongo_uri() -> String {
    let uri =
        std::env::var("TEST_MONGO_URI").unwrap_or_else(|_| DEFAULT_TEST_MONGO_URI.to_string());
    let loopback = uri.contains("://127.0.0.1") || uri.contains("://localhost");

    if loopback && !uri.contains("directConnection=") {
        let separator = if uri.contains('?') { '&' } else { '?' };
        format!("{uri}{separator}directConnection=true")
    } else {
        uri
    }
}

struct Harness {
    db: Database,
    repos: Repos,
}

impl Harness {
    async fn new(lease_seconds: i64) -> Self {
        let uri = test_mongo_uri();
        let client = Client::with_uri_str(&uri)
            .await
            .unwrap_or_else(|err| panic!("connect to TEST_MONGO_URI ({uri}): {err}"));

        let db_name = format!("media_worker_fencing_{}", ObjectId::new().to_hex());
        let db = client.database(&db_name);
        let config = Arc::new(test_config(&db_name, lease_seconds));
        let repos = Repos::new(&db, config);

        Self { db, repos }
    }

    async fn seed_job(&self, job: Document) -> ObjectId {
        let id = job.get_object_id("_id").expect("seed job carries an _id");
        self.repos
            .jobs
            .insert_one(job)
            .await
            .expect("insert seed MediaJob");
        id
    }

    async fn seed_media(&self, media: Document) -> ObjectId {
        let id = media
            .get_object_id("_id")
            .expect("seed media carries an _id");
        self.repos
            .media
            .insert_one(media)
            .await
            .expect("insert seed Media");
        id
    }

    async fn media(&self, id: &ObjectId) -> Document {
        self.repos
            .media
            .find_one(doc! { "_id": id })
            .await
            .expect("read Media")
            .expect("Media still exists")
    }

    async fn classification_count(&self) -> u64 {
        self.repos
            .classifications
            .count_documents(doc! {})
            .await
            .expect("count MediaClassification")
    }

    async fn cleanup(self) {
        let _ = self.db.drop().await;
    }
}

fn test_config(db_name: &str, lease_seconds: i64) -> Config {
    Config {
        mongo_uri: DEFAULT_TEST_MONGO_URI.to_string(),
        mongo_db: db_name.to_string(),
        redis_url: "redis://127.0.0.1:6379".to_string(),
        aws_region: "ap-southeast-1".to_string(),
        s3_bucket: "contract-tests".to_string(),
        google_vision_api_key: String::new(),
        job_queue: "media:jobs:queue".to_string(),
        inflight_queue: "media:jobs:inflight".to_string(),
        dispatch_lock_prefix: "dispatched:".to_string(),
        max_concurrent_jobs: 1,
        lease_seconds,
        retry_backoff_base_seconds: RETRY_BACKOFF_BASE_SECONDS,
        retry_backoff_max_seconds: RETRY_BACKOFF_MAX_SECONDS,
        scratch_dir: std::env::temp_dir()
            .join("media-worker-contract-tests")
            .to_string_lossy()
            .into_owned(),
    }
}

fn in_seconds(seconds: i64) -> BsonDateTime {
    BsonDateTime::from_millis(BsonDateTime::now().timestamp_millis() + seconds * 1_000)
}

fn base_job(status: &str, media_id: &ObjectId) -> Document {
    let now = BsonDateTime::now();
    doc! {
        "_id": ObjectId::new(),
        "mediaId": media_id,
        "postId": Bson::Null,
        "jobType": "OPTIMIZE_IMAGE",
        "status": status,
        "idempotencyKey": format!("fencing-{}", ObjectId::new().to_hex()),
        "pipelineVersion": "contract-v1",
        "priority": 0i32,
        "attempts": 0i64,
        "maxAttempts": 5i64,
        "availableAt": now,
        "startedAt": Bson::Null,
        "completedAt": Bson::Null,
        "lockedBy": Bson::Null,
        "lockToken": Bson::Null,
        "leaseExpiresAt": Bson::Null,
        "lastError": {
            "code": Bson::Null,
            "message": Bson::Null,
            "retryable": Bson::Null,
            "occurredAt": Bson::Null,
        },
        "createdAt": now,
        "updatedAt": now,
    }
}

fn pending_job(media_id: &ObjectId) -> Document {
    base_job("PENDING", media_id)
}

fn processing_job(
    media_id: &ObjectId,
    lock_token: &str,
    lease_expires_at: BsonDateTime,
) -> Document {
    let mut job = base_job("PROCESSING", media_id);
    job.insert("lockedBy", "seed-worker");
    job.insert("lockToken", lock_token);
    job.insert("leaseExpiresAt", lease_expires_at);
    job.insert("startedAt", BsonDateTime::now());
    job
}

fn media_doc(key: &str) -> Document {
    let now = BsonDateTime::now();
    doc! {
        "_id": ObjectId::new(),
        "key": key,
        "processingStatus": "PENDING",
        "uploadStatus": "COMPLETE",
        "moderationStatus": "PENDING",
        "variants": {},
        "createdAt": now,
        "updatedAt": now,
    }
}

fn classification_record(status: &str, reason: &str) -> ClassificationCommit {
    ClassificationCommit {
        provider: "contract-provider".to_string(),
        pipeline_version: "contract-v1".to_string(),
        model_version: None,
        source_fingerprint: "contract-fingerprint".to_string(),
        labels: vec![Bson::Document(doc! {
            "name": "room",
            "score": 0.92,
            "providerLabel": "Room",
        })],
        categories: vec!["room".to_string()],
        moderation_status: status.to_string(),
        moderation_reason: reason.to_string(),
    }
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn extend_lease_rejects_replaced_token_and_expired_lease() {
    let harness = Harness::new(300).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;

    let replaced = harness
        .seed_job(processing_job(&media_id, "live-token", in_seconds(300)))
        .await;
    assert!(
        harness
            .repos
            .extend_lease(&replaced, "live-token")
            .await
            .expect("renew live lease"),
        "the live owner must be able to renew"
    );

    harness
        .repos
        .jobs
        .update_one(
            doc! { "_id": &replaced },
            doc! { "$set": { "lockToken": "replacement-token" } },
        )
        .await
        .expect("replace lock token");
    assert!(
        !harness
            .repos
            .extend_lease(&replaced, "live-token")
            .await
            .expect("renew replaced lease"),
        "a replaced token must not be renewable"
    );

    let expired = harness
        .seed_job(processing_job(&media_id, "expired-token", in_seconds(-60)))
        .await;
    assert!(
        !harness
            .repos
            .extend_lease(&expired, "expired-token")
            .await
            .expect("renew expired lease"),
        "an expired lease must not be revived"
    );

    harness.cleanup().await;
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn fenced_media_commit_requires_live_token() {
    let harness = Harness::new(300).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;
    let job_id = harness
        .seed_job(processing_job(&media_id, "live-token", in_seconds(300)))
        .await;

    let live_key = "media/u/1/p/2/m/optimized/live-token/webp-1200".to_string();
    let committed = harness
        .repos
        .set_media_processed(
            &job_id,
            "live-token",
            &media_id,
            &[("webp-1200".to_string(), live_key.clone())],
            "live-checksum",
        )
        .await
        .expect("commit live media");
    assert_eq!(committed, MediaCommitOutcome::Committed);

    let media = harness.media(&media_id).await;
    assert_eq!(media.get_str("processingStatus").ok(), Some("DONE"));
    assert_eq!(
        media
            .get_document("variants")
            .ok()
            .and_then(|variants| variants.get_str("webp-1200").ok()),
        Some(live_key.as_str())
    );

    // A reaper/replacement moves ownership to another attempt.
    harness
        .repos
        .jobs
        .update_one(
            doc! { "_id": &job_id },
            doc! {
                "$set": {
                    "lockToken": "replacement-token",
                    "leaseExpiresAt": in_seconds(300),
                }
            },
        )
        .await
        .expect("replace lock token");

    let stale_key = "media/u/1/p/2/m/optimized/stale-token/webp-1200".to_string();
    let stale = harness
        .repos
        .set_media_processed(
            &job_id,
            "live-token",
            &media_id,
            &[("webp-1200".to_string(), stale_key)],
            "stale-checksum",
        )
        .await
        .expect("stale fenced commit");
    assert_eq!(stale, MediaCommitOutcome::LeaseLost);

    let media = harness.media(&media_id).await;
    let variants = media.get_document("variants").expect("variants exist");
    assert_eq!(
        variants.get_str("webp-1200").ok(),
        Some(live_key.as_str()),
        "a stale attempt must not overwrite the current variant key"
    );
    assert_eq!(
        media.get_str("checksum").ok(),
        Some("live-checksum"),
        "a stale attempt must not overwrite the committed checksum"
    );

    harness.cleanup().await;
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn fenced_classification_skips_moderation_for_stale_token() {
    let harness = Harness::new(300).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;
    let job_id = harness
        .seed_job(processing_job(&media_id, "old-token", in_seconds(300)))
        .await;

    // Another worker has already replaced this attempt's token.
    harness
        .repos
        .jobs
        .update_one(
            doc! { "_id": &job_id },
            doc! {
                "$set": {
                    "lockToken": "current-token",
                    "leaseExpiresAt": in_seconds(300),
                }
            },
        )
        .await
        .expect("replace lock token");

    let stale = harness
        .repos
        .upsert_classification(
            &job_id,
            "old-token",
            &media_id,
            &classification_record("REJECTED", "stale attempt must not decide"),
        )
        .await
        .expect("stale classification commit");
    assert_eq!(stale, MediaCommitOutcome::LeaseLost);

    let media = harness.media(&media_id).await;
    assert_eq!(
        media.get_str("moderationStatus").ok(),
        Some("PENDING"),
        "a stale classification must not change moderation state"
    );
    assert_eq!(
        harness.classification_count().await,
        0,
        "a stale classification must not upsert a classification document"
    );

    // The live token commits the classification and moderation atomically.
    let live = harness
        .repos
        .upsert_classification(
            &job_id,
            "current-token",
            &media_id,
            &classification_record("APPROVED", "live attempt"),
        )
        .await
        .expect("live classification commit");
    assert_eq!(live, MediaCommitOutcome::Committed);

    let media = harness.media(&media_id).await;
    assert_eq!(media.get_str("moderationStatus").ok(), Some("APPROVED"));
    assert_eq!(
        media.get_str("lastModerationReason").ok(),
        Some("live attempt")
    );
    assert_eq!(harness.classification_count().await, 1);

    harness.cleanup().await;
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn heartbeat_keeps_a_short_lease_alive_past_original_expiry() {
    let harness = Harness::new(3).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;
    let job_id = harness.seed_job(pending_job(&media_id)).await;

    let claimed = harness
        .repos
        .claim_job(&job_id, "heartbeat-worker")
        .await
        .expect("claim job");
    let token = match claimed {
        ClaimOutcome::Claimed(document) => document
            .get_str("lockToken")
            .expect("claim writes a lock token")
            .to_string(),
        ClaimOutcome::Skipped => panic!("seed job must be claimable"),
    };

    let job_cancel = CancellationToken::new();
    let heartbeat = LeaseHeartbeat::start(
        harness.repos.clone(),
        job_id,
        token.clone(),
        job_cancel.clone(),
    )
    .await;

    // The original lease is 3 seconds. The heartbeat renews every second, so
    // ownership must still be valid well past the original expiry.
    tokio::time::sleep(Duration::from_millis(4_500)).await;

    assert!(
        !job_cancel.is_cancelled(),
        "heartbeat must not cancel a healthy job"
    );
    let completed = harness
        .repos
        .complete_job(&job_id, &token)
        .await
        .expect("complete renewed job");
    heartbeat.stop().await;

    assert!(
        matches!(completed, CompleteOutcome::Completed),
        "the renewed lease must still allow completion"
    );

    harness.cleanup().await;
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn heartbeat_cancels_work_when_token_is_replaced() {
    let harness = Harness::new(3).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;
    let job_id = harness.seed_job(pending_job(&media_id)).await;

    let claimed = harness
        .repos
        .claim_job(&job_id, "heartbeat-worker")
        .await
        .expect("claim job");
    let token = match claimed {
        ClaimOutcome::Claimed(document) => document
            .get_str("lockToken")
            .expect("claim writes a lock token")
            .to_string(),
        ClaimOutcome::Skipped => panic!("seed job must be claimable"),
    };

    let job_cancel = CancellationToken::new();
    let heartbeat = LeaseHeartbeat::start(
        harness.repos.clone(),
        job_id,
        token.clone(),
        job_cancel.clone(),
    )
    .await;

    harness
        .repos
        .jobs
        .update_one(
            doc! { "_id": &job_id },
            doc! {
                "$set": {
                    "lockToken": "replacement-token",
                    "leaseExpiresAt": in_seconds(300),
                }
            },
        )
        .await
        .expect("replace lock token");

    // The next renewal happens within one second.
    tokio::time::sleep(Duration::from_millis(2_000)).await;

    assert!(
        job_cancel.is_cancelled(),
        "heartbeat must cancel the job after ownership is replaced"
    );
    heartbeat.stop().await;

    let completed = harness
        .repos
        .complete_job(&job_id, &token)
        .await
        .expect("stale completion");
    assert!(
        matches!(completed, CompleteOutcome::LeaseLost),
        "the stale worker must not complete the job"
    );

    harness.cleanup().await;
}

// ---------------------------------------------------------------------------
// Verifier (S1-E) adversarial tests.
// ---------------------------------------------------------------------------

/// Verifier: an expired lease fences both the media and the classification
/// write, including the moderation column on `Media`.
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn expired_lease_cannot_commit_media_or_classification() {
    let harness = Harness::new(300).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;
    let job_id = harness
        .seed_job(processing_job(
            &media_id,
            "expired-commit-token",
            in_seconds(-60),
        ))
        .await;

    let stale_key = "media/u/1/p/2/m/optimized/expired-commit-token/webp-1200".to_string();
    let media_outcome = harness
        .repos
        .set_media_processed(
            &job_id,
            "expired-commit-token",
            &media_id,
            &[("webp-1200".to_string(), stale_key)],
            "stale-checksum",
        )
        .await
        .expect("attempt fenced media commit on an expired lease");
    let classification_outcome = harness
        .repos
        .upsert_classification(
            &job_id,
            "expired-commit-token",
            &media_id,
            &classification_record("REJECTED", "expired attempt must not decide"),
        )
        .await
        .expect("attempt fenced classification commit on an expired lease");

    assert_eq!(
        media_outcome,
        MediaCommitOutcome::LeaseLost,
        "an expired lease must not publish renditions"
    );
    assert_eq!(
        classification_outcome,
        MediaCommitOutcome::LeaseLost,
        "an expired lease must not publish a classification"
    );

    let media = harness.media(&media_id).await;
    assert_eq!(
        media.get_str("processingStatus").ok(),
        Some("PENDING"),
        "an expired attempt must not mark the media processed"
    );
    let variants = media.get_document("variants").expect("variants document");
    assert!(
        variants.is_empty(),
        "an expired attempt must not publish variant keys, got {variants:?}"
    );
    assert!(
        media.get("checksum").is_none(),
        "an expired attempt must not publish a checksum"
    );
    assert_eq!(
        media.get_str("moderationStatus").ok(),
        Some("PENDING"),
        "an expired attempt must not change moderation state"
    );
    assert_eq!(
        harness.classification_count().await,
        0,
        "an expired attempt must not upsert a classification document"
    );

    harness.cleanup().await;
}

/// Verifier: a live lease whose expiry is renewed does not report ownership
/// loss, even when two renewals land in the same millisecond and the stored
/// value therefore does not change. `extend_lease` must prove ownership with
/// the match count, not the modification count.
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn same_millisecond_lease_renewal_is_not_ownership_loss() {
    let harness = Harness::new(300).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;
    let job_id = harness
        .seed_job(processing_job(&media_id, "renew-token", in_seconds(300)))
        .await;

    // Two consecutive renewals occasionally sample the same millisecond, so
    // the stored expiry is written back unchanged. Probe enough renewals to
    // make that same-millisecond case overwhelmingly likely.
    for iteration in 0..500 {
        let renewed = harness
            .repos
            .extend_lease(&job_id, "renew-token")
            .await
            .expect("renew live lease");
        if !renewed {
            // Prove that ownership was actually intact for this renewal: the
            // job is still PROCESSING under our exact token with a live lease.
            let job = harness
                .repos
                .jobs
                .find_one(doc! { "_id": &job_id })
                .await
                .expect("read job after a rejected renewal")
                .expect("job exists");
            let still_owned = job.get_str("status").ok() == Some("PROCESSING")
                && job.get_str("lockToken").ok() == Some("renew-token")
                && job
                    .get_datetime("leaseExpiresAt")
                    .is_ok_and(|lease| *lease > BsonDateTime::now());
            harness.cleanup().await;
            panic!(
                "extend_lease reported lease loss at renewal {iteration} although the job was \
                 still owned ({still_owned}); a renewal whose new expiry equals the stored \
                 expiry (same millisecond) must prove ownership with the match count, not the \
                 modification count"
            );
        }
    }

    harness.cleanup().await;
}

/// Verifier: a heartbeat that is dropped without `stop()` (the panic/abort
/// unwind path) must not leave a detached renewal task that keeps the lease
/// alive forever. A panic in the handler drops the `LeaseHeartbeat` without
/// running `stop()`, and an orphaned heartbeat would make the job unreapable.
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn dropped_heartbeat_must_stop_renewing() {
    let harness = Harness::new(2).await;
    let media_id = harness.seed_media(media_doc("media/u/1/p/2/m/raw")).await;
    let job_id = harness.seed_job(pending_job(&media_id)).await;

    let claimed = harness
        .repos
        .claim_job(&job_id, "drop-worker")
        .await
        .expect("claim job");
    let token = match claimed {
        ClaimOutcome::Claimed(document) => document
            .get_str("lockToken")
            .expect("claim writes a lock token")
            .to_string(),
        ClaimOutcome::Skipped => panic!("seed job must be claimable"),
    };

    let job_cancel = CancellationToken::new();
    let heartbeat = LeaseHeartbeat::start(
        harness.repos.clone(),
        job_id,
        token.clone(),
        job_cancel.clone(),
    )
    .await;
    // Simulate a panic/abort unwind: the handle is dropped, `stop()` never runs.
    drop(heartbeat);

    // The claimed lease is 2 seconds; a detached renewal task would renew it
    // every second and keep it alive indefinitely.
    tokio::time::sleep(Duration::from_millis(3_500)).await;

    let renewed = harness
        .repos
        .extend_lease(&job_id, &token)
        .await
        .expect("probe lease after dropping the heartbeat handle");

    job_cancel.cancel();
    harness.cleanup().await;

    assert!(
        !renewed,
        "dropping the heartbeat handle must stop renewal: a detached task keeps \
         the lease alive after a handler panic/abort and the job can never be reaped"
    );
}
