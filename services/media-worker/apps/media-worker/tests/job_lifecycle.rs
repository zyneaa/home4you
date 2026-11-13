//! Black-box contract tests for the MongoDB job lifecycle.
//!
//! These tests talk to a real replica set because the worker relies on
//! MongoDB update semantics (`$unset`, `$inc`, conditional filters) that mocks
//! would not reproduce faithfully. They are `#[ignore]`d so the default suite
//! never needs Docker:
//!
//! ```text
//! TEST_MONGO_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0' \
//!   cargo test -p media-worker --test job_lifecycle -- --ignored --test-threads=1
//! ```
//!
//! Every test uses a unique disposable database and drops it before asserting.
//! Loopback URIs are connected with `directConnection=true` so a Docker-hosted
//! replica set that advertises `mongo:27017` stays reachable from the host.

use std::sync::Arc;

use mongodb::bson::{doc, oid::ObjectId, Bson, DateTime as BsonDateTime, Document};
use mongodb::{Client, Database};

use media_worker::config::Config;
use media_worker::jobs::{ClaimOutcome, CompleteOutcome, Repos};

const DEFAULT_TEST_MONGO_URI: &str = "mongodb://127.0.0.1:27017/?replicaSet=rs0";
const LEASE_SECONDS: i64 = 300;
const RETRY_BACKOFF_BASE_SECONDS: i64 = 30;
const RETRY_BACKOFF_MAX_SECONDS: i64 = 3600;

/// Resolve the database used by every test.
///
/// Config may point at a Docker-published replica set whose members advertise
/// their in-network hostname (for example `mongo:27017`). Host-run tests
/// cannot resolve that name, so for loopback URIs we ask the driver to talk to
/// the seed directly instead of chasing the advertised member. The target is
/// still the `rs0` replica set; non-loopback URIs are used verbatim.
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

/// A disposable database plus the `Repos` used by the worker, wired with a
/// real `Config` literal rather than environment-derived values.
struct Harness {
    db: Database,
    repos: Repos,
}

impl Harness {
    async fn new() -> Self {
        let uri = test_mongo_uri();
        let client = Client::with_uri_str(&uri)
            .await
            .unwrap_or_else(|err| panic!("connect to TEST_MONGO_URI ({uri}): {err}"));

        let db_name = format!("media_worker_contract_{}", ObjectId::new().to_hex());
        let db = client.database(&db_name);
        let config = Arc::new(test_config(&db_name));
        let repos = Repos::new(&db, config);

        Self { db, repos }
    }

    async fn seed(&self, job: Document) -> ObjectId {
        let id = job.get_object_id("_id").expect("seed job carries an _id");
        self.repos
            .jobs
            .insert_one(job)
            .await
            .expect("insert seed MediaJob");
        id
    }

    async fn job(&self, id: &ObjectId) -> Document {
        self.repos
            .jobs
            .find_one(doc! { "_id": id })
            .await
            .expect("read MediaJob")
            .expect("MediaJob still exists")
    }

    /// Best-effort cleanup; the unique database name keeps leftovers isolated.
    async fn cleanup(self) {
        let _ = self.db.drop().await;
    }
}

fn test_config(db_name: &str) -> Config {
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
        lease_seconds: LEASE_SECONDS,
        retry_backoff_base_seconds: RETRY_BACKOFF_BASE_SECONDS,
        retry_backoff_max_seconds: RETRY_BACKOFF_MAX_SECONDS,
        scratch_dir: std::env::temp_dir()
            .join("media-worker-contract-tests")
            .to_string_lossy()
            .into_owned(),
    }
}

/// Document shape mirrors `services/core/src/modules/media/mediaJob.model.mts`.
fn base_job(status: &str, attempts: i64, max_attempts: i64) -> Document {
    let now = BsonDateTime::now();
    doc! {
        "_id": ObjectId::new(),
        "mediaId": ObjectId::new(),
        "postId": Bson::Null,
        "jobType": "OPTIMIZE_IMAGE",
        "status": status,
        "idempotencyKey": format!("contract-{}", ObjectId::new().to_hex()),
        "pipelineVersion": "contract-v1",
        "priority": 0i32,
        "attempts": attempts,
        "maxAttempts": max_attempts,
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

fn pending_job(attempts: i64, max_attempts: i64, available_at: Option<BsonDateTime>) -> Document {
    let mut job = base_job("PENDING", attempts, max_attempts);
    let _ = match available_at {
        Some(at) => job.insert("availableAt", at),
        None => job.remove("availableAt"),
    };
    job
}

fn processing_job(
    attempts: i64,
    max_attempts: i64,
    lock_token: &str,
    lease_expires_at: BsonDateTime,
) -> Document {
    let mut job = base_job("PROCESSING", attempts, max_attempts);
    job.insert("lockedBy", "seed-worker");
    job.insert("lockToken", lock_token);
    job.insert("leaseExpiresAt", lease_expires_at);
    job.insert("startedAt", BsonDateTime::now());
    job
}

fn status(doc: &Document) -> &str {
    doc.get_str("status").expect("job has a status")
}

fn assert_lease_cleared(doc: &Document, context: &str) {
    for field in ["lockedBy", "lockToken", "leaseExpiresAt"] {
        match doc.get(field) {
            None | Some(Bson::Null) => {}
            Some(value) => panic!("{context}: expected `{field}` cleared, got {value:?}"),
        }
    }
}

fn attempts(doc: &Document) -> i64 {
    doc.get_i64("attempts").expect("job has attempts")
}

fn lease_in(seconds: i64) -> BsonDateTime {
    BsonDateTime::from_millis(BsonDateTime::now().timestamp_millis() + seconds * 1_000)
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn permanent_failure_on_attempt_one_becomes_failed() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(
            0,
            5,
            "permanent-token",
            BsonDateTime::from_millis(
                BsonDateTime::now().timestamp_millis() + LEASE_SECONDS * 1000,
            ),
        ))
        .await;

    harness
        .repos
        .fail_job(
            &job_id,
            "permanent-token",
            "unsupported media container",
            false,
        )
        .await
        .expect("record permanent failure");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(
        status(&job),
        "FAILED",
        "non-retryable failures must not return to PENDING"
    );
    assert_eq!(attempts(&job), 1, "the failed execution is counted once");
    assert_lease_cleared(&job, "permanent failure");
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn retryable_failure_below_cap_returns_to_pending() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(
            1,
            5,
            "retry-token",
            BsonDateTime::from_millis(
                BsonDateTime::now().timestamp_millis() + LEASE_SECONDS * 1000,
            ),
        ))
        .await;
    let before = BsonDateTime::now();

    harness
        .repos
        .fail_job(&job_id, "retry-token", "vision provider timeout", true)
        .await
        .expect("record retryable failure");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(
        status(&job),
        "PENDING",
        "retryable failures below the cap must be requeued"
    );
    assert_eq!(attempts(&job), 2, "the failed execution is counted once");

    let available_at = job
        .get_datetime("availableAt")
        .expect("retry sets availableAt");
    assert!(
        available_at.timestamp_millis() > before.timestamp_millis(),
        "retry must be delayed into the future, got {available_at:?}"
    );
    assert_lease_cleared(&job, "retryable failure");
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn retryable_failure_at_cap_becomes_failed() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(
            4,
            5,
            "cap-token",
            BsonDateTime::from_millis(
                BsonDateTime::now().timestamp_millis() + LEASE_SECONDS * 1000,
            ),
        ))
        .await;

    harness
        .repos
        .fail_job(&job_id, "cap-token", "vision provider timeout", true)
        .await
        .expect("record retryable failure");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(
        status(&job),
        "FAILED",
        "a retryable failure at the attempt cap must become terminal"
    );
    assert_eq!(attempts(&job), 5, "the fifth attempt exhausts the budget");
    assert_lease_cleared(&job, "retryable failure at cap");
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn future_available_at_cannot_be_claimed() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(pending_job(
            0,
            5,
            Some(BsonDateTime::from_millis(
                BsonDateTime::now().timestamp_millis() + 3_600_000,
            )),
        ))
        .await;

    let outcome = harness
        .repos
        .claim_job(&job_id, "contract-worker")
        .await
        .expect("claim attempt");

    let claimed = matches!(outcome, ClaimOutcome::Claimed(_));
    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert!(
        !claimed,
        "a job must not be claimed before its availableAt backoff expires"
    );
    assert_eq!(status(&job), "PENDING");
    assert_lease_cleared(&job, "future availableAt claim attempt");
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn absent_or_null_available_at_remains_claimable() {
    let harness = Harness::new().await;
    let absent_id = harness.seed(pending_job(0, 5, None)).await;

    let mut null_job = base_job("PENDING", 0, 5);
    null_job.insert("availableAt", Bson::Null);
    let null_id = harness.seed(null_job).await;

    let absent_outcome = harness
        .repos
        .claim_job(&absent_id, "contract-worker")
        .await
        .expect("claim legacy job without availableAt");
    let null_outcome = harness
        .repos
        .claim_job(&null_id, "contract-worker")
        .await
        .expect("claim legacy job with null availableAt");

    let absent_claimed = matches!(absent_outcome, ClaimOutcome::Claimed(_));
    let null_claimed = matches!(null_outcome, ClaimOutcome::Claimed(_));
    let absent_job = harness.job(&absent_id).await;
    let null_job = harness.job(&null_id).await;
    harness.cleanup().await;

    assert!(
        absent_claimed,
        "legacy rows with no availableAt must remain claimable"
    );
    assert!(
        null_claimed,
        "legacy rows with null availableAt must remain claimable"
    );
    assert_eq!(status(&absent_job), "PROCESSING");
    assert_eq!(status(&null_job), "PROCESSING");
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn expired_job_at_attempt_cap_is_failed_by_reaper() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(
            4,
            5,
            "expired-cap-token",
            BsonDateTime::from_millis(BsonDateTime::now().timestamp_millis() - 60_000),
        ))
        .await;

    harness
        .repos
        .reap_expired_leases()
        .await
        .expect("reap expired lease");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(
        status(&job),
        "FAILED",
        "the reaper must not requeue past the attempt cap"
    );
    assert_eq!(
        attempts(&job),
        5,
        "the crashed execution consumes the last attempt"
    );
    assert!(
        job.get_datetime("completedAt").is_ok(),
        "terminal reaping sets completedAt"
    );
    assert_lease_cleared(&job, "reaper at attempt cap");
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn concurrent_reapers_transition_expired_job_exactly_once() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(
            1,
            5,
            "concurrent-token",
            BsonDateTime::from_millis(BsonDateTime::now().timestamp_millis() - 60_000),
        ))
        .await;

    let (first, second) = tokio::join!(
        harness.repos.reap_expired_leases(),
        harness.repos.reap_expired_leases()
    );
    let first = first.expect("first reaper");
    let second = second.expect("second reaper");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(
        first + second,
        1,
        "only one reaper may transition a given job (got {first} + {second})"
    );
    assert_eq!(
        status(&job),
        "PENDING",
        "a non-exhausted expired job returns to PENDING"
    );
    assert_eq!(
        attempts(&job),
        2,
        "concurrent reapers must not double-increment attempts"
    );
    let last_error = job
        .get_document("lastError")
        .expect("reaper records lastError");
    assert_eq!(
        last_error.get_bool("retryable").ok(),
        Some(true),
        "expired leases are retryable"
    );
    assert_lease_cleared(&job, "concurrent reapers");
}

#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn completed_job_cannot_be_completed_again_by_stale_token() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(
            0,
            5,
            "attempt-1-token",
            BsonDateTime::from_millis(
                BsonDateTime::now().timestamp_millis() + LEASE_SECONDS * 1000,
            ),
        ))
        .await;

    let first = harness
        .repos
        .complete_job(&job_id, "attempt-1-token")
        .await
        .expect("complete job with the live token");
    assert!(
        matches!(first, CompleteOutcome::Completed),
        "the live lease holder must be able to complete its job"
    );

    let completed = harness.job(&job_id).await;
    let completed_at = *completed
        .get_datetime("completedAt")
        .expect("completion timestamps the job");

    let replay = harness
        .repos
        .complete_job(&job_id, "attempt-1-token")
        .await
        .expect("replay completion");
    let stale = harness
        .repos
        .complete_job(&job_id, "stale-attempt-token")
        .await
        .expect("stale completion");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert!(
        matches!(replay, CompleteOutcome::LeaseLost),
        "a replayed completion must not mutate a completed job"
    );
    assert!(
        matches!(stale, CompleteOutcome::LeaseLost),
        "a stale worker must not complete a job it no longer owns"
    );
    assert_eq!(status(&job), "COMPLETED");
    assert_eq!(
        job.get_datetime("completedAt").ok(),
        Some(&completed_at),
        "completedAt must not be rewritten by stale completions"
    );
    assert_lease_cleared(&job, "stale completion");
}

// ---------------------------------------------------------------------------
// Verifier (S1-E) adversarial tests.
// ---------------------------------------------------------------------------

/// Verifier: a correct token is not enough — the lease itself must be live.
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn complete_job_rejects_expired_lease_with_correct_token() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(0, 5, "expired-complete-token", lease_in(-1)))
        .await;

    let outcome = harness
        .repos
        .complete_job(&job_id, "expired-complete-token")
        .await
        .expect("attempt completion on an expired lease");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert!(
        matches!(outcome, CompleteOutcome::LeaseLost),
        "an expired lease must not be able to complete a job"
    );
    assert_eq!(
        status(&job),
        "PROCESSING",
        "a rejected completion must leave the job untouched"
    );
    assert_eq!(
        job.get_str("lockToken").ok(),
        Some("expired-complete-token"),
        "a rejected completion must not clear the current token"
    );
    assert!(
        job.get_datetime("leaseExpiresAt").is_ok(),
        "a rejected completion must not clear the lease"
    );
    assert!(
        matches!(job.get("completedAt"), Some(Bson::Null) | None),
        "a rejected completion must not stamp completedAt"
    );
}

/// Verifier: two workers racing to record the same attempt's failure must
/// produce exactly one attempt increment and one recorded failure.
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn concurrent_fail_job_records_one_attempt_and_one_failure() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(
            0,
            5,
            "dual-fail-token",
            lease_in(LEASE_SECONDS),
        ))
        .await;

    let (first, second) = tokio::join!(
        harness
            .repos
            .fail_job(&job_id, "dual-fail-token", "transient failure A", true),
        harness
            .repos
            .fail_job(&job_id, "dual-fail-token", "transient failure B", true)
    );
    first.expect("first concurrent failure");
    second.expect("second concurrent failure");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(
        attempts(&job),
        1,
        "concurrent failures for one attempt must increment attempts exactly once"
    );
    assert_eq!(
        status(&job),
        "PENDING",
        "the single recorded failure keeps the job retryable below the cap"
    );
    assert_lease_cleared(&job, "concurrent failures");
    let last_error = job
        .get_document("lastError")
        .expect("the winning failure is recorded");
    assert_eq!(
        last_error.get_bool("retryable").ok(),
        Some(true),
        "the recorded failure carries the retry flag"
    );
    let message = last_error
        .get_str("message")
        .expect("the recorded failure carries a message");
    assert!(
        message == "transient failure A" || message == "transient failure B",
        "exactly one failure message must be persisted, got {message:?}"
    );
    assert!(
        job.get_datetime("availableAt").is_ok(),
        "the retry backoff is scheduled once"
    );
}

/// Verifier: the reaper's attempt budget is enforced exactly once.
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn reaper_fails_final_attempt_and_never_requeues_it() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(4, 5, "final-attempt-token", lease_in(-60)))
        .await;

    let first = harness
        .repos
        .reap_expired_leases()
        .await
        .expect("first reap");
    let after_first = harness.job(&job_id).await;
    let second = harness
        .repos
        .reap_expired_leases()
        .await
        .expect("second reap");
    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(first, 1, "the expired job is transitioned once");
    assert_eq!(
        status(&after_first),
        "FAILED",
        "attempts = maxAttempts - 1 must fail, not requeue"
    );
    assert_eq!(attempts(&after_first), 5);
    assert_eq!(second, 0, "a FAILED job must not be reaped again");
    assert_eq!(status(&job), "FAILED", "the terminal state is stable");
    assert_eq!(attempts(&job), 5, "repeated reaping must not increment");
    assert_lease_cleared(&job, "reaped final attempt");
}

/// Verifier: `claim_job` honors the attempt budget without an off-by-one.
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn claim_allows_final_attempt_and_refuses_exhausted_budget() {
    let harness = Harness::new().await;
    let final_attempt = harness
        .seed(pending_job(4, 5, Some(BsonDateTime::now())))
        .await;
    let exhausted = harness
        .seed(pending_job(5, 5, Some(BsonDateTime::now())))
        .await;

    let final_outcome = harness
        .repos
        .claim_job(&final_attempt, "budget-worker")
        .await
        .expect("claim final permitted attempt");
    let exhausted_outcome = harness
        .repos
        .claim_job(&exhausted, "budget-worker")
        .await
        .expect("claim exhausted job");

    let final_job = harness.job(&final_attempt).await;
    let exhausted_job = harness.job(&exhausted).await;
    harness.cleanup().await;

    assert!(
        matches!(final_outcome, ClaimOutcome::Claimed(_)),
        "attempts = maxAttempts - 1 is the last permitted execution and must be claimable"
    );
    assert!(
        matches!(exhausted_outcome, ClaimOutcome::Skipped),
        "attempts = maxAttempts must not be claimed"
    );
    assert_eq!(status(&final_job), "PROCESSING");
    assert_eq!(
        status(&exhausted_job),
        "PENDING",
        "an exhausted PENDING job must be left untouched by the claim"
    );
    assert_lease_cleared(&exhausted_job, "exhausted claim attempt");
}

/// Verifier: an expired lease also blocks the failure transition (issue 4
/// fencing applies to failure, not only completion).
#[tokio::test]
#[ignore = "requires MongoDB replica set"]
async fn fail_job_with_expired_lease_does_not_mutate_job() {
    let harness = Harness::new().await;
    let job_id = harness
        .seed(processing_job(0, 5, "expired-fail-token", lease_in(-1)))
        .await;

    harness
        .repos
        .fail_job(
            &job_id,
            "expired-fail-token",
            "should not be recorded",
            true,
        )
        .await
        .expect("attempt failure on an expired lease");

    let job = harness.job(&job_id).await;
    harness.cleanup().await;

    assert_eq!(
        status(&job),
        "PROCESSING",
        "an expired lease must not write a failure transition"
    );
    assert_eq!(attempts(&job), 0, "attempts must not increment");
    assert_eq!(
        job.get_str("lockToken").ok(),
        Some("expired-fail-token"),
        "lease fields must be left for the reaper"
    );
    let last_error = job.get_document("lastError").expect("lastError exists");
    assert!(
        matches!(last_error.get("message"), Some(Bson::Null)),
        "no failure message may be recorded, got {message:?}",
        message = last_error.get("message")
    );
}
