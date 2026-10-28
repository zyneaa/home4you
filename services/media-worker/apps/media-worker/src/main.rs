//! media-worker: consumes processing/classification jobs from Redis,
//! claims MediaJob leases in MongoDB, and executes the work using the
//! media-processing and media-classification libraries.

mod config;
mod jobs;
mod queue;
mod s3;
mod worker;

use std::sync::Arc;

use anyhow::Context;
use futures::StreamExt;
use mongodb::bson::doc;
use mongodb::options::ClientOptions;

use crate::config::Config;
use crate::jobs::Repos;
use crate::queue::JobQueue;
use crate::s3::MediaStore;
use crate::worker::Worker;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Development-only .env loading; production relies on real env vars.
    #[cfg(debug_assertions)]
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,aws_config=warn".into()),
        )
        .init();

    let config = Arc::new(Config::from_env());
    if config.s3_bucket.is_empty() {
        anyhow::bail!("AWS_S3_BUCKET_NAME is required");
    }

    let shutdown = tokio_util::sync::CancellationToken::new();
    let worker_id = format!("media-worker-{}", uuid::Uuid::new_v4());
    tracing::info!(worker_id, "starting media worker");

    // MongoDB
    let mongo_opts = ClientOptions::parse(&config.mongo_uri)
        .await
        .context("parse MONGO_URI")?;
    let mongo = mongodb::Client::with_options(mongo_opts)?.database(&config.mongo_db);
    let repos = Repos::new(&mongo, config.clone());

    // Redis (distribution layer only)
    let redis_client = redis::Client::open(config.redis_url.as_str())?;
    let redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("connect redis")?;
    let queue = JobQueue::new(
        redis_conn,
        config.job_queue.clone(),
        config.inflight_queue.clone(),
    );

    // Requeue crash survivors so in-flight messages are not lost.
    let requeued = queue.drain_inflight().await?;
    tracing::info!(requeued, "drained in-flight queue");

    // S3
    let aws_cfg = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let s3 = aws_sdk_s3::Client::new(&aws_cfg);
    let store = MediaStore::new(s3, config.s3_bucket.clone());

    // Classification (independent from processing: a Vision outage must not
    // block optimization).
    let classifier =
        media_classification::ClassificationService::new(config.google_vision_api_key.clone())
            .ok()
            .map(Arc::new);

    // Lease reaper: recover PROCESSING jobs from crashed workers.
    {
        let repos = repos.clone();
        let shutdown = shutdown.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    _ = shutdown.cancelled() => break,
                    _ = ticker.tick() => {
                        match repos.reap_expired_leases().await {
                            Ok(n) if n > 0 => tracing::info!(reclaimed = n, "reaped expired leases"),
                            Ok(_) => {}
                            Err(e) => tracing::error!(error = %e, "lease reaper failed"),
                        }
                    }
                }
            }
        });
    }

    // Watch S3 object events (optional diagnostics): stream pipeline kept
    // simple — workers do not need watch for correctness.
    let _watch = futures::stream::iter(Vec::<()>::new()).collect::<Vec<_>>();

    let worker = Worker::new(repos.clone(), queue, store, classifier, shutdown.clone());

    // Graceful shutdown on SIGINT/SIGTERM.
    let shutdown_for_signal = shutdown.clone();
    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
        let mut int = signal(SignalKind::interrupt()).expect("SIGINT handler");
        tokio::select! {
            _ = term.recv() => {},
            _ = int.recv() => {},
        }
        tracing::info!("shutdown signal received; draining in-flight jobs");
        shutdown_for_signal.cancel();
    });

    worker.run().await?;

    // Final sweep so crash-survivor records do not linger after shutdown.
    match repos
        .jobs
        .count_documents(doc! { "status": "PROCESSING" })
        .await
    {
        Ok(n) => tracing::info!(processing = n, "remaining PROCESSING jobs after shutdown"),
        Err(e) => tracing::warn!(error = %e, "post-shutdown count failed"),
    }

    tracing::info!("media worker stopped");
    Ok(())
}
