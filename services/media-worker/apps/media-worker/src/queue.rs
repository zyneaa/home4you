//! Redis queue consumption. Redis is the distribution layer, NOT the record
//! of work: losing a message is safe because the MongoDB MediaJob documents
//! remain durable and the core dispatcher re-publishes PENDING jobs.
//!
//! Pattern: BRPOPLPUSH onto an in-flight list; crash survivors are drained
//! back into the main queue at startup. Successful jobs are LREM'd from the
//! in-flight list (ack). Failed jobs are also acked — the durable job record
//! plus per-attempt dispatch dedup drives retries.

use redis::aio::MultiplexedConnection;
use redis::AsyncCommands;

#[derive(Clone)]
pub struct JobQueue {
    conn: MultiplexedConnection,
    queue: String,
    inflight: String,
}

impl JobQueue {
    pub fn new(conn: MultiplexedConnection, queue: String, inflight: String) -> Self {
        Self {
            conn,
            queue,
            inflight,
        }
    }

    /// Requeue crash survivors from the in-flight list back to the queue.
    pub async fn drain_inflight(&self) -> anyhow::Result<usize> {
        let mut conn = self.conn.clone();
        let mut count = 0;
        loop {
            let raw: Option<String> = redis::cmd("RPOPLPUSH")
                .arg(&self.inflight)
                .arg(&self.queue)
                .query_async(&mut conn)
                .await
                .ok();

            match raw {
                Some(raw) => {
                    tracing::info!(raw, "requeued in-flight job from previous run");
                    count += 1;
                }
                None => break,
            }
        }
        Ok(count)
    }

    /// Block up to `timeout_secs` for a job; moves it to the in-flight list.
    pub async fn pop(&self, timeout_secs: u64) -> anyhow::Result<Option<String>> {
        let mut conn = self.conn.clone();
        let raw: Option<String> = redis::cmd("BRPOPLPUSH")
            .arg(&self.queue)
            .arg(&self.inflight)
            .arg(timeout_secs)
            .query_async(&mut conn)
            .await?;
        Ok(raw)
    }

    /// Acknowledge: remove from the in-flight list after terminal handling.
    pub async fn ack(&self, raw: &str) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        let _: () = conn.lrem(&self.inflight, 1, raw).await?;
        Ok(())
    }
}
