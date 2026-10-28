//! MongoDB job claims and state updates. The MediaJob collection is the
//! source of truth; every mutation is guarded by the current status and the
//! lease token so a stale worker can never clobber a reclaimed job.

use std::sync::Arc;

use chrono::{Duration, Utc};
use mongodb::bson::Array;
use mongodb::bson::{doc, oid::ObjectId, DateTime as BsonDateTime, Document};
use mongodb::{Collection, Database};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::config::Config;

/// Payload published by the core dispatcher onto the Redis queue. Some
/// fields are informational/correlation only but part of the wire contract.
#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
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
                doc! { "_id": job_id, "status": "PENDING" },
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

    /// Record a failure: retry with exponential backoff while attempts
    /// remain, else mark FAILED permanently.
    pub async fn fail_job(
        &self,
        job_id: &ObjectId,
        lock_token: &str,
        message: &str,
        retryable: bool,
    ) -> anyhow::Result<()> {
        let job = self
            .jobs
            .find_one(doc! { "_id": job_id, "lockToken": lock_token })
            .await?;
        let Some(job) = job else {
            tracing::warn!(job_id = job_id.to_hex(), "lease lost while failing job");
            return Ok(());
        };

        let attempts = job.get_i64("attempts").unwrap_or(0);
        let max_attempts = job.get_i64("maxAttempts").unwrap_or(5);
        let next_attempt = attempts + 1;

        let backoff = (self.config.retry_backoff_base_seconds * next_attempt)
            .min(self.config.retry_backoff_max_seconds);
        let available_at = BsonDateTime::from_millis(
            Utc::now().timestamp_millis() + Duration::seconds(backoff).num_milliseconds(),
        );

        if next_attempt >= max_attempts {
            let _ = self
                .jobs
                .update_one(
                    doc! { "_id": job_id, "lockToken": lock_token },
                    doc! {
                        "$set": {
                            "status": "FAILED",
                            "attempts": next_attempt,
                            "completedAt": BsonDateTime::now(),
                            "lastError": {
                                "message": message,
                                "retryable": retryable,
                                "occurredAt": BsonDateTime::now(),
                            }
                        },
                        "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" }
                    },
                )
                .await?;
        } else {
            let _ = self
                .jobs
                .update_one(
                    doc! { "_id": job_id, "lockToken": lock_token },
                    doc! {
                        "$set": {
                            "status": "PENDING",
                            "attempts": next_attempt,
                            "availableAt": available_at,
                            "lastError": {
                                "message": message,
                                "retryable": retryable,
                                "occurredAt": BsonDateTime::now(),
                            }
                        },
                        "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" }
                    },
                )
                .await?;
        }
        Ok(())
    }

    /// Recover jobs whose worker crashed mid-flight: requeue PROCESSING jobs
    /// with an expired lease. Runs on a timer in main.
    pub async fn reap_expired_leases(&self) -> anyhow::Result<u64> {
        let now = BsonDateTime::now();
        let res = self
            .jobs
            .update_many(
                doc! { "status": "PROCESSING", "leaseExpiresAt": { "$lt": now } },
                doc! {
                    "$set": {
                        "status": "PENDING",
                        "availableAt": now,
                        "lastError": {
                            "message": "lease expired (worker crash)",
                            "retryable": true,
                            "occurredAt": now,
                        }
                    },
                    "$inc": { "attempts": 1 },
                    "$unset": { "lockedBy": "", "lockToken": "", "leaseExpiresAt": "" }
                },
            )
            .await?;
        Ok(res.modified_count)
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
