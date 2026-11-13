//! MongoDB job claims and state updates. The MediaJob collection is the
//! source of truth; every mutation is guarded by the current status and the
//! lease token so a stale worker can never clobber a reclaimed job.
//!
//! # Attempt budget convention
//!
//! `attempts` counts *completed* execution attempts and starts at `0`. The
//! first execution is attempt 1. `maxAttempts` is the maximum total number of
//! executions allowed for a job.
//!
//! A failure therefore leaves `attempts + 1` completed attempts:
//!
//! - `attempts + 1 < maxAttempts`: another execution is allowed, so the job
//!   returns to `PENDING`.
//! - `attempts + 1 >= maxAttempts`: the budget is exhausted, so the job
//!   becomes `FAILED`.
//!
//! `claim_job` refuses to start an execution when `attempts >= maxAttempts`,
//! while still allowing the final permitted execution
//! (`attempts == maxAttempts - 1`). The expired-lease reaper applies the same
//! convention: the crashed execution counts as completed before deciding
//! whether to requeue or fail the job.

use std::sync::Arc;

use mongodb::bson::{doc, oid::ObjectId, Array, Bson, DateTime as BsonDateTime, Document};
use mongodb::{Collection, Database};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::config::Config;

/// Payload published by the core dispatcher onto the Redis queue. Some
/// fields are informational/correlation only but part of the wire contract.
#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JobPayload {
    pub job_id: String,
    pub media_id: String,
    #[serde(default)]
    pub post_id: Option<String>,
    pub job_type: String,
    pub attempt: i64,
    pub created_at: String,
    #[serde(default)]
    pub pipeline_version: String,
}

pub enum ClaimOutcome {
    Claimed(Document),
    /// Someone else holds it, it already completed, or it vanished — not an
    /// error; the message is simply acked without work.
    Skipped,
}

pub enum CompleteOutcome {
    Completed,
    /// Lease was lost/expired/reclaimed: do not write partial state.
    LeaseLost,
}

// `posts` and the policy methods are consumed by the moderation/review
// flows that land with the next episodes.
#[allow(dead_code)]
#[derive(Clone)]
pub struct Repos {
    pub jobs: Collection<Document>,
    pub media: Collection<Document>,
    pub classifications: Collection<Document>,
    pub posts: Collection<Document>,
    pub config: Arc<Config>,
}

impl Repos {
    pub fn new(db: &Database, config: Arc<Config>) -> Self {
        Self {
            // Mongoose model "MediaJob" -> default collection "mediajobs".
            jobs: db.collection("mediajobs"),
            media: db.collection("media"),
            classifications: db.collection("mediaclassifications"),
            posts: db.collection("posts"),
            config,
        }
    }

    /// Atomically claim a PENDING job for this worker (lease-based).
    pub async fn claim_job(
        &self,
        job_id: &ObjectId,
        worker_id: &str,
    ) -> anyhow::Result<ClaimOutcome> {
        let now = BsonDateTime::now();
        let lease_until =
            BsonDateTime::from_millis(now.timestamp_millis() + self.config.lease_seconds * 1000);
        let lock_token = uuid::Uuid::new_v4().to_string();

        let updated = self
            .jobs
            .find_one_and_update(
                doc! {
                    "_id": job_id,
                    "status": "PENDING",
                    // `availableAt` is authoritative; absent/null fields are
                    // legacy rows created before backoff existed.
                    "$or": [
                        { "availableAt": { "$lte": now } },
                        { "availableAt": Bson::Null },
                    ],
                    // Compare document fields inside MongoDB so a stale
                    // PENDING row cannot exceed its budget even if our read
                    // was racy.
                    "$expr": {
                        "$lt": [
                            { "$ifNull": ["$attempts", 0] },
                            { "$ifNull": ["$maxAttempts", 5] },
                        ]
                    },
                },
                doc! {
                    "$set": {
                        "status": "PROCESSING",
                        "startedAt": now,
                        "lockedBy": worker_id,
                        "lockToken": &lock_token,
                        "leaseExpiresAt": lease_until,
                    }
                },
            )
            .return_document(mongodb::options::ReturnDocument::After)
            .await?;

        Ok(updated.map_or(ClaimOutcome::Skipped, ClaimOutcome::Claimed))
    }

    /// Mark complete — only while we still hold the lease.
    pub async fn complete_job(
        &self,
        job_id: &ObjectId,
        lock_token: &str,
    ) -> anyhow::Result<CompleteOutcome> {
        let res = self
            .jobs
            .update_one(
                doc! { "_id": job_id, "status": "PROCESSING", "lockToken": lock_token },
                doc! {
                    "$set": { "status": "COMPLETED", "completedAt": BsonDateTime::now() },
                    "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" }
                },
            )
            .await?;
        Ok(if res.modified_count == 1 {
            CompleteOutcome::Completed
        } else {
            CompleteOutcome::LeaseLost
        })
    }

    /// Record a failure: permanent failures go straight to FAILED; retryable
    /// failures return to PENDING with capped exponential backoff only while
    /// the attempt budget allows. Every write is fenced by the current lease.
    pub async fn fail_job(
        &self,
        job_id: &ObjectId,
        lock_token: &str,
        message: &str,
        retryable: bool,
    ) -> anyhow::Result<()> {
        let now = BsonDateTime::now();
        let job = self
            .jobs
            .find_one(doc! { "_id": job_id, "status": "PROCESSING", "lockToken": lock_token })
            .await?;
        let Some(job) = job else {
            tracing::warn!(job_id = job_id.to_hex(), "lease lost while failing job");
            return Ok(());
        };

        let attempts = read_i64(&job, "attempts").unwrap_or(0);
        let max_attempts = read_i64(&job, "maxAttempts").unwrap_or(5);
        let disposition = retry_disposition(retryable, attempts, max_attempts);

        // Fence the write on the state we just read: same owner, still
        // PROCESSING, a lease that has not expired, and the exact attempt
        // count. A concurrent/stale worker that already recorded this failure
        // changes `attempts` and can no longer match.
        let filter = doc! {
            "_id": job_id,
            "status": "PROCESSING",
            "lockToken": lock_token,
            "leaseExpiresAt": { "$gt": now },
            "$expr": {
                "$eq": [
                    { "$ifNull": ["$attempts", 0] },
                    attempts,
                ]
            },
        };

        let last_error = doc! {
            "message": message,
            "retryable": retryable,
            "occurredAt": now,
        };

        let update = match disposition {
            RetryDisposition::Terminal { next_attempt } => doc! {
                "$set": {
                    "status": "FAILED",
                    "attempts": next_attempt,
                    "completedAt": now,
                    "lastError": last_error,
                },
                "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" },
            },
            RetryDisposition::Retry { next_attempt } => {
                let delay = retry_delay_seconds(
                    self.config.retry_backoff_base_seconds,
                    self.config.retry_backoff_max_seconds,
                    &job_id.to_hex(),
                    next_attempt,
                );
                let available_at = BsonDateTime::from_millis(
                    now.timestamp_millis()
                        .saturating_add(delay.saturating_mul(1_000)),
                );
                doc! {
                    "$set": {
                        "status": "PENDING",
                        "attempts": next_attempt,
                        "availableAt": available_at,
                        "lastError": last_error,
                    },
                    "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" },
                }
            }
        };

        let result = self.jobs.update_one(filter, update).await?;
        if result.matched_count == 0 {
            tracing::warn!(
                job_id = job_id.to_hex(),
                attempts,
                "failure update matched no job (stale lease or concurrent failure); not writing"
            );
        }
        Ok(())
    }

    /// Recover jobs whose worker crashed mid-flight. The crashed execution
    /// counts as a completed attempt: exhausted jobs become FAILED, the rest
    /// return to PENDING immediately. Runs on a timer in main.
    ///
    /// Both updates share one cutoff and require `status: PROCESSING` plus an
    /// expired lease. The terminal update runs first, and each status guard
    /// means a concurrent reaper can only transition a given job once.
    pub async fn reap_expired_leases(&self) -> anyhow::Result<u64> {
        let cutoff = BsonDateTime::now();

        // 1. Exhausted leases: attempts + 1 >= maxAttempts.
        let failed = self
            .jobs
            .update_many(
                doc! {
                    "status": "PROCESSING",
                    "leaseExpiresAt": { "$lt": cutoff },
                    "$expr": {
                        "$gte": [
                            { "$add": [{ "$ifNull": ["$attempts", 0] }, 1] },
                            { "$ifNull": ["$maxAttempts", 5] },
                        ]
                    },
                },
                doc! {
                    "$set": {
                        "status": "FAILED",
                        "completedAt": cutoff,
                        "lastError": {
                            "message": "lease expired (worker crash); attempt budget exhausted",
                            "retryable": false,
                            "occurredAt": cutoff,
                        }
                    },
                    "$inc": { "attempts": 1 },
                    "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" }
                },
            )
            .await?;

        // 2. Leases with budget left: requeue. Any job moved to FAILED above
        // no longer matches `status: PROCESSING`.
        let requeued = self
            .jobs
            .update_many(
                doc! {
                    "status": "PROCESSING",
                    "leaseExpiresAt": { "$lt": cutoff },
                    "$expr": {
                        "$lt": [
                            { "$add": [{ "$ifNull": ["$attempts", 0] }, 1] },
                            { "$ifNull": ["$maxAttempts", 5] },
                        ]
                    },
                },
                doc! {
                    "$set": {
                        "status": "PENDING",
                        "availableAt": cutoff,
                        "lastError": {
                            "message": "lease expired (worker crash)",
                            "retryable": true,
                            "occurredAt": cutoff,
                        }
                    },
                    "$inc": { "attempts": 1 },
                    "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" }
                },
            )
            .await?;

        Ok(failed.modified_count + requeued.modified_count)
    }

    /// Fetch the Media document backing a job.
    pub async fn get_media(&self, media_oid: &ObjectId) -> anyhow::Result<Option<Document>> {
        Ok(self.media.find_one(doc! { "_id": media_oid }).await?)
    }

    /// Fetch the Post document backing a job (if any).
    #[allow(dead_code)]
    pub async fn get_post(&self, post_oid: &ObjectId) -> anyhow::Result<Option<Document>> {
        Ok(self.posts.find_one(doc! { "_id": post_oid }).await?)
    }

    /// Persist rendition metadata on Media. Uses per-rendition `$set` with
    /// dotted paths so a Map field updates without replacing the whole map.
    pub async fn set_media_processed(
        &self,
        media_oid: &ObjectId,
        variant_keys: &[(String, String)],
        checksum: &str,
    ) -> anyhow::Result<()> {
        let mut sets = doc! {
            "processingStatus": "DONE",
            "checksum": checksum,
        };
        for (name, key) in variant_keys {
            sets.insert(format!("variants.{name}"), key);
        }
        self.media
            .update_one(doc! { "_id": media_oid }, doc! { "$set": sets })
            .await?;
        Ok(())
    }

    /// Mark a media record rejected (corrupt/unsupported/policy violation).
    #[allow(dead_code)]
    pub async fn set_media_rejected(
        &self,
        media_oid: &ObjectId,
        reason: &str,
    ) -> anyhow::Result<()> {
        self.media
            .update_one(
                doc! { "_id": media_oid },
                doc! {
                    "$set": {
                        "uploadStatus": "FAILED",
                        "moderationStatus": "REJECTED",
                        "lastModerationReason": reason,
                    }
                },
            )
            .await?;
        Ok(())
    }

    /// Set moderation status without failing the upload (review path).
    pub async fn set_moderation_status(
        &self,
        media_oid: &ObjectId,
        status: &str,
        reason: &str,
    ) -> anyhow::Result<()> {
        self.media
            .update_one(
                doc! { "_id": media_oid },
                doc! {
                    "$set": {
                        "moderationStatus": status,
                        "lastModerationReason": reason,
                    }
                },
            )
            .await?;
        Ok(())
    }

    /// Idempotency pre-check for classification: an existing result for the
    /// same media + pipeline version + exact source bytes is authoritative.
    pub async fn find_classification(
        &self,
        media_oid: &ObjectId,
        pipeline_version: &str,
        source_fingerprint: &str,
    ) -> anyhow::Result<Option<Document>> {
        Ok(self
            .classifications
            .find_one(doc! {
                "mediaId": media_oid,
                "pipelineVersion": pipeline_version,
                "sourceFingerprint": source_fingerprint,
            })
            .await?)
    }

    /// Store classification results (upsert on mediaId, the unique key).
    pub async fn upsert_classification(
        &self,
        media_oid: &ObjectId,
        provider: &str,
        pipeline_version: &str,
        model_version: Option<&str>,
        source_fingerprint: &str,
        labels: Array,
        categories: Vec<String>,
    ) -> anyhow::Result<()> {
        let mut doc_body = doc! {
            "mediaId": media_oid,
            "provider": provider,
            "pipelineVersion": pipeline_version,
            "modelVersion": model_version,
            "sourceFingerprint": source_fingerprint,
            "labels": labels,
            "categories": categories,
            "classifiedAt": BsonDateTime::now(),
        };
        // Keep original createdAt on upsert via $setOnInsert equivalent.
        doc_body.remove("mediaId");

        let _ = self
            .classifications
            .update_one(
                doc! { "mediaId": media_oid },
                doc! {
                    "$set": doc_body,
                    "$setOnInsert": { "mediaId": media_oid }
                },
            )
            .upsert(true)
            .await?;
        Ok(())
    }
}

/// Outcome of recording a failed execution, derived only from the retry flag
/// and the job's attempt budget. Kept free of Mongo/database concerns so the
/// policy can be unit-tested directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RetryDisposition {
    Retry { next_attempt: i64 },
    Terminal { next_attempt: i64 },
}

/// Read an integer that may have been stored as `Int32`, `Int64`, or (as
/// Mongoose `Number` fields typically are) `Double`.
fn read_i64(document: &Document, key: &str) -> Option<i64> {
    match document.get(key)? {
        Bson::Int32(value) => Some(i64::from(*value)),
        Bson::Int64(value) => Some(*value),
        Bson::Double(value) if value.is_finite() => Some(*value as i64),
        _ => None,
    }
}

/// Decide whether a failed execution may be retried.
///
/// `attempts` is the number of completed executions *before* this failure;
/// the returned `next_attempt` includes the failure being recorded. A
/// non-positive `max_attempts` exhausts the budget immediately rather than
/// panicking or allowing unbounded retries.
pub(crate) fn retry_disposition(
    retryable: bool,
    attempts: i64,
    max_attempts: i64,
) -> RetryDisposition {
    let next_attempt = attempts.max(0).saturating_add(1);
    if !retryable || next_attempt >= max_attempts.max(0) {
        RetryDisposition::Terminal { next_attempt }
    } else {
        RetryDisposition::Retry { next_attempt }
    }
}

/// Deterministic capped exponential delay before jitter. Attempt 1 uses
/// `base_seconds`; each subsequent attempt doubles it up to `max_seconds`.
///
/// The exponent is clamped before shifting/multiplying and the multiplication
/// saturates, so even `i64::MAX` attempts cannot overflow. Non-positive
/// configuration values return `0` instead of panicking.
pub(crate) fn exponential_base_delay_seconds(
    base_seconds: i64,
    max_seconds: i64,
    next_attempt: i64,
) -> i64 {
    if base_seconds <= 0 || max_seconds <= 0 {
        return 0;
    }
    // Attempt 1 uses the base delay; 62 is the largest safe left-shift so
    // `base * 2^exponent` saturates rather than wrapping.
    let exponent = (next_attempt.max(1).saturating_sub(1)).min(62) as u32;
    let raw = (base_seconds as u64).saturating_mul(1u64 << exponent);
    raw.min(max_seconds as u64) as i64
}

/// Stable, deterministic jitter in permille (thousandths of the base delay):
/// the result is always within `[-2000, 2000]`, i.e. ±20%.
///
/// Deriving the jitter from SHA-256 of the job id and next attempt makes it
/// reproducible across workers and reapers while still spreading retries
/// that would otherwise line up.
fn jitter_permille(job_id: &str, next_attempt: i64) -> i64 {
    let mut hasher = Sha256::new();
    hasher.update(job_id.as_bytes());
    hasher.update(b":");
    hasher.update(next_attempt.to_string().as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    // Map the hash into 4001 buckets so the range is inclusive of ±20%.
    let value = u64::from_le_bytes(bytes) % 4_001;
    value as i64 - 2_000
}

/// Final retry delay with bounded deterministic jitter in `[0, max_seconds]`.
pub(crate) fn retry_delay_seconds(
    base_seconds: i64,
    max_seconds: i64,
    job_id: &str,
    next_attempt: i64,
) -> i64 {
    let base_delay = exponential_base_delay_seconds(base_seconds, max_seconds, next_attempt);
    if base_delay <= 0 || max_seconds <= 0 {
        return 0;
    }
    let permille = jitter_permille(job_id, next_attempt) as i128;
    let jittered = i128::from(base_delay) + (i128::from(base_delay) * permille) / 10_000;
    jittered.clamp(0, i128::from(max_seconds)) as i64
}

/// SHA-256 hex fingerprint of the exact analyzed bytes.
pub fn fingerprint(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    let mut hex = String::with_capacity(out.len() * 2);
    for b in out {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

/// Parse a dispatcher payload into (job_id, media_id) ObjectIds.
pub fn parse_payload(raw: &str) -> anyhow::Result<JobPayload> {
    let payload: JobPayload = serde_json::from_str(raw)?;
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permanent_failure_is_terminal_on_first_attempt() {
        assert_eq!(
            retry_disposition(false, 0, 5),
            RetryDisposition::Terminal { next_attempt: 1 }
        );
        assert_eq!(
            retry_disposition(false, 3, 5),
            RetryDisposition::Terminal { next_attempt: 4 }
        );
    }

    #[test]
    fn retryable_below_cap_retries() {
        assert_eq!(
            retry_disposition(true, 0, 5),
            RetryDisposition::Retry { next_attempt: 1 }
        );
        assert_eq!(
            retry_disposition(true, 3, 5),
            RetryDisposition::Retry { next_attempt: 4 }
        );
    }

    #[test]
    fn retryable_at_or_past_cap_is_terminal() {
        assert_eq!(
            retry_disposition(true, 4, 5),
            RetryDisposition::Terminal { next_attempt: 5 }
        );
        assert_eq!(
            retry_disposition(true, 5, 5),
            RetryDisposition::Terminal { next_attempt: 6 }
        );
    }

    #[test]
    fn exponential_backoff_grows_then_plateaus() {
        let base = 30;
        let max = 3600;
        let expected = [30, 60, 120, 240, 480, 960, 1920, 3600];
        for (index, want) in expected.iter().enumerate() {
            let attempt = index as i64 + 1;
            assert_eq!(
                exponential_base_delay_seconds(base, max, attempt),
                *want,
                "attempt {attempt}"
            );
        }
    }

    #[test]
    fn exponential_backoff_enforces_cap() {
        let base = 30;
        let max = 3600;
        let mut previous = 0;
        for attempt in 1..=10 {
            let delay = exponential_base_delay_seconds(base, max, attempt);
            assert!(delay >= previous, "delay must not decrease");
            assert!(delay <= max, "delay {delay} exceeded cap {max}");
            previous = delay;
        }
        assert_eq!(previous, max);
        for attempt in [64, 1_000, i64::MAX] {
            assert_eq!(exponential_base_delay_seconds(base, max, attempt), max);
        }
    }

    #[test]
    fn jitter_is_deterministic_and_bounded() {
        let base = 100;
        let max = 3600;
        let first = retry_delay_seconds(base, max, "job-123", 1);
        assert_eq!(first, retry_delay_seconds(base, max, "job-123", 1));

        let mut seen = std::collections::BTreeSet::new();
        for index in 0..200 {
            let id = format!("job-{index}");
            let delay = retry_delay_seconds(base, max, &id, 1);
            assert!((0..=max).contains(&delay), "delay {delay} outside bounds");
            assert!(
                (80..=120).contains(&delay),
                "delay {delay} outside ±20% for {id}"
            );
            seen.insert(delay);
        }
        assert!(seen.len() > 1, "jitter should vary across job ids");
    }

    #[test]
    fn huge_attempt_counts_do_not_overflow() {
        assert_eq!(exponential_base_delay_seconds(30, 3600, i64::MAX), 3600);
        let delay = retry_delay_seconds(30, 3600, "job-1", i64::MAX);
        assert!((0..=3600).contains(&delay));
        assert_eq!(
            retry_disposition(true, i64::MAX, i64::MAX),
            RetryDisposition::Terminal {
                next_attempt: i64::MAX
            }
        );
    }

    #[test]
    fn non_positive_backoff_config_is_defensive() {
        assert_eq!(exponential_base_delay_seconds(0, 3600, 5), 0);
        assert_eq!(exponential_base_delay_seconds(-1, 3600, 5), 0);
        assert_eq!(exponential_base_delay_seconds(30, 0, 5), 0);
        assert_eq!(retry_delay_seconds(0, 3600, "job", 5), 0);
        assert_eq!(retry_delay_seconds(30, -1, "job", 5), 0);
    }
}
