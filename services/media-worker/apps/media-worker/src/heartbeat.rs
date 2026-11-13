//! Per-job lease heartbeat.
//!
//! A [`LeaseHeartbeat`] renews one job's MongoDB lease while the handler runs.
//! It renews once immediately (to confirm that the claim is still ours) and
//! then every `lease_renewal_interval_secs(lease_seconds)` — one third of the
//! lease, so there is room for at least two failed renewals before the lease
//! could expire.
//!
//! Failure policy:
//!
//! - `extend_lease` returning `false` means the job was completed/reclaimed or
//!   the lock token was replaced. The heartbeat cancels the per-job token
//!   immediately; the handler stops and no fenced commit can succeed.
//! - A database error is retried every second while we are still inside the
//!   safe part of the lease (`lease - interval` since the last successful
//!   renewal). Once that window is exhausted the heartbeat cancels the job
//!   rather than waiting for ambiguous ownership at expiry.
//! - Cancellation, success, failure, and worker shutdown all stop the task;
//!   [`LeaseHeartbeat::stop`] aborts and joins the handle so no heartbeat is
//!   ever detached.

use std::time::Duration;

use mongodb::bson::oid::ObjectId;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::jobs::{lease_renewal_interval_secs, Repos};

/// Pure scheduling policy for one heartbeat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeartbeatSchedule {
    /// Delay between successful renewals.
    pub interval: Duration,
    /// Delay before retrying a failed renewal.
    pub error_retry: Duration,
    /// Maximum time since the last confirmed renewal before an error becomes
    /// an ownership loss. Kept below the lease duration so the worker never
    /// waits until the last instant.
    pub safe_deadline: Duration,
}

impl HeartbeatSchedule {
    pub fn from_lease_seconds(lease_seconds: i64) -> Self {
        let interval = Duration::from_secs(lease_renewal_interval_secs(lease_seconds));
        let lease = Duration::from_secs(lease_seconds.max(1) as u64);
        Self {
            interval,
            // Retry promptly, but do not stampede a failing database.
            error_retry: interval.min(Duration::from_secs(1)),
            // One full renewal interval of margin before expiry.
            safe_deadline: lease.saturating_sub(interval),
        }
    }
}

/// Handle for one job's heartbeat task.
pub struct LeaseHeartbeat {
    cancel: CancellationToken,
    handle: JoinHandle<()>,
}

impl LeaseHeartbeat {
    /// Confirm ownership and start renewing until cancelled.
    ///
    /// `job_cancel` is cancelled if the heartbeat detects ownership loss. It is
    /// usually a child of the worker shutdown token, so shutdown also stops the
    /// handler and the heartbeat.
    pub async fn start(
        repos: Repos,
        job_id: ObjectId,
        lock_token: String,
        job_cancel: CancellationToken,
    ) -> Self {
        let schedule = HeartbeatSchedule::from_lease_seconds(repos.config.lease_seconds);
        let cancel = CancellationToken::new();

        if job_cancel.is_cancelled() {
            return Self {
                cancel,
                handle: tokio::spawn(async {}),
            };
        }

        // Immediate confirmation: a claim that was already reaped or replaced
        // must stop the handler before it does any visible work.
        let initial_confirmed = match repos.extend_lease(&job_id, &lock_token).await {
            Ok(true) => {
                tracing::debug!(job = %job_id, "lease heartbeat confirmed ownership");
                true
            }
            Ok(false) => {
                tracing::warn!(job = %job_id, "lease lost before heartbeat start; cancelling job work");
                job_cancel.cancel();
                true
            }
            Err(error) => {
                tracing::warn!(
                    job = %job_id,
                    error = %error,
                    "initial lease renewal failed; heartbeat will retry inside the safe lease window"
                );
                false
            }
        };

        let task_cancel = cancel.clone();
        let handle = tokio::spawn(async move {
            run_heartbeat(
                repos,
                job_id,
                lock_token,
                job_cancel,
                task_cancel,
                schedule,
                initial_confirmed,
            )
            .await;
        });

        Self { cancel, handle }
    }

    /// Stop and join the heartbeat. Safe to call on every exit path.
    pub async fn stop(self) {
        let Self { cancel, handle } = self;
        cancel.cancel();
        // Abort handles the case where the task is blocked in a MongoDB call;
        // at worst the in-flight renewal extends the existing lease, which is
        // harmless once the job is being completed or abandoned.
        handle.abort();
        match handle.await {
            Ok(()) => {}
            Err(error) if error.is_cancelled() => {}
            Err(error) => tracing::warn!(error = %error, "lease heartbeat task failed"),
        }
    }
}

async fn run_heartbeat(
    repos: Repos,
    job_id: ObjectId,
    lock_token: String,
    job_cancel: CancellationToken,
    heartbeat_cancel: CancellationToken,
    schedule: HeartbeatSchedule,
    initial_confirmed: bool,
) {
    let mut last_confirmed = tokio::time::Instant::now();
    // A failed immediate renewal is retried promptly instead of waiting a
    // whole renewal interval.
    let mut next_delay = if initial_confirmed {
        schedule.interval
    } else {
        schedule.error_retry
    };

    loop {
        tokio::select! {
            _ = job_cancel.cancelled() => return,
            _ = heartbeat_cancel.cancelled() => return,
            _ = tokio::time::sleep(next_delay) => {}
        }
        next_delay = schedule.interval;

        // A failed renewal is retried in a tight inner loop, but never past
        // the safe part of the lease measured from the last success.
        loop {
            if job_cancel.is_cancelled() || heartbeat_cancel.is_cancelled() {
                return;
            }

            match repos.extend_lease(&job_id, &lock_token).await {
                Ok(true) => {
                    last_confirmed = tokio::time::Instant::now();
                    break;
                }
                Ok(false) => {
                    tracing::warn!(
                        job = %job_id,
                        "lease renewal rejected: ownership moved; cancelling job work"
                    );
                    job_cancel.cancel();
                    return;
                }
                Err(error) => {
                    if last_confirmed.elapsed() >= schedule.safe_deadline {
                        tracing::error!(
                            job = %job_id,
                            error = %error,
                            "lease renewal failed past the safe window; cancelling job work"
                        );
                        job_cancel.cancel();
                        return;
                    }

                    tracing::warn!(
                        job = %job_id,
                        error = %error,
                        "lease renewal failed; retrying inside the safe lease window"
                    );
                    tokio::select! {
                        _ = job_cancel.cancelled() => return,
                        _ = heartbeat_cancel.cancelled() => return,
                        _ = tokio::time::sleep(schedule.error_retry) => {}
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::lease_renewal_interval_secs;

    #[test]
    fn heartbeat_interval_wiring_uses_the_one_third_helper() {
        for lease_seconds in [1, 2, 3, 30, 300, 900] {
            let schedule = HeartbeatSchedule::from_lease_seconds(lease_seconds);
            assert_eq!(
                schedule.interval,
                Duration::from_secs(lease_renewal_interval_secs(lease_seconds)),
                "lease {lease_seconds}"
            );
        }
        assert_eq!(
            HeartbeatSchedule::from_lease_seconds(300).interval,
            Duration::from_secs(100)
        );
    }

    #[test]
    fn error_policy_stays_inside_the_lease() {
        let schedule = HeartbeatSchedule::from_lease_seconds(300);
        assert_eq!(schedule.error_retry, Duration::from_secs(1));
        assert_eq!(schedule.safe_deadline, Duration::from_secs(200));
        assert!(schedule.interval < schedule.safe_deadline);
        assert!(schedule.safe_deadline < Duration::from_secs(300));
    }

    #[test]
    fn short_leases_still_renew_every_second() {
        let schedule = HeartbeatSchedule::from_lease_seconds(2);
        assert_eq!(schedule.interval, Duration::from_secs(1));
        assert_eq!(schedule.safe_deadline, Duration::from_secs(1));

        let schedule = HeartbeatSchedule::from_lease_seconds(0);
        assert_eq!(schedule.interval, Duration::from_secs(1));
        assert_eq!(schedule.safe_deadline, Duration::ZERO);
    }
}
