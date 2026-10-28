use std::env;

// aws_region and dispatch_lock_prefix are reserved for regional S3
// routing and dispatcher-dedup coordination respectively.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct Config {
    pub mongo_uri: String,
    pub mongo_db: String,
    pub redis_url: String,
    pub aws_region: String,
    pub s3_bucket: String,
    pub google_vision_api_key: String,

    /// Queue names: distribution layer; MongoDB MediaJob is the source of truth.
    pub job_queue: String,
    pub inflight_queue: String,
    pub dispatch_lock_prefix: String,

    /// Bounded concurrency: images can decompress far beyond their
    /// compressed size — start small, tune by measurement.
    pub max_concurrent_jobs: usize,

    /// Lease duration for PROCESSING jobs; expired leases are reclaimed.
    pub lease_seconds: i64,
    /// Backoff base for retryable failures (exponential, capped).
    pub retry_backoff_base_seconds: i64,
    pub retry_backoff_max_seconds: i64,
    /// Local scratch dir for video transcoding.
    pub scratch_dir: String,
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            mongo_uri: env_or("MONGO_URI", "mongodb://mongo:27017/?replicaSet=rs0"),
            mongo_db: env_or("MONGO_DB", "home4you"),
            redis_url: env_or("REDIS_URL", "redis://redis:6379"),
            aws_region: env_or("AWS_REGION", "ap-southeast-1"),
            s3_bucket: env_or("AWS_S3_BUCKET_NAME", ""),
            google_vision_api_key: env_or("GOOGLE_VISION_API_KEY", ""),

            job_queue: env_or("JOB_QUEUE", "media:jobs:queue"),
            inflight_queue: env_or("JOB_INFLIGHT_QUEUE", "media:jobs:inflight"),
            dispatch_lock_prefix: env_or("DISPATCH_LOCK_PREFIX", "dispatched:"),

            max_concurrent_jobs: env_or("MAX_CONCURRENT_JOBS", "2").parse().unwrap_or(2),
            lease_seconds: env_or("LEASE_SECONDS", "300").parse().unwrap_or(300),
            retry_backoff_base_seconds: env_or("RETRY_BACKOFF_BASE_SECONDS", "30")
                .parse()
                .unwrap_or(30),
            retry_backoff_max_seconds: env_or("RETRY_BACKOFF_MAX_SECONDS", "3600")
                .parse()
                .unwrap_or(3600),
            scratch_dir: env_or("SCRATCH_DIR", "/tmp/media-worker"),
        }
    }
}
