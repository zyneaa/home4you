import { redisClient } from "@config";
import { MediaJob, MediaJobStatus } from "@modules/media/mediaJob.model.mjs";
import { logger } from "@utils";
import cron from "node-cron";

// Redis is the distribution layer, not the record of work: MediaJob
// documents are the durable source of truth. Losing a queue message is
// recoverable — the dispatcher re-publishes PENDING jobs on its next tick.
const JOB_QUEUE = "media:jobs:queue";

// Dedup marker TTL: prevents duplicate queue entries across dispatcher
// ticks. Keyed by attempt so a FAILED job that returns to PENDING with a
// higher attempt number is re-dispatched instead of being blocked.
const DISPATCH_DEDUP_TTL_SECONDS = 24 * 60 * 60;

export async function dispatchPendingJobs(limit = 100): Promise<number> {
  const jobs = await MediaJob.find({
    status: MediaJobStatus.PENDING,
    availableAt: { $lte: new Date() },
  })
    .sort({ priority: -1, createdAt: 1 })
    .limit(limit)
    .select("_id mediaId postId jobType attempts pipelineVersion createdAt")
    .lean();

  if (!jobs.length) {
    return 0;
  }

  let dispatched = 0;

  for (const job of jobs) {
    const payload = JSON.stringify({
      jobId: job._id,
      mediaId: job.mediaId,
      postId: job.postId,
      jobType: job.jobType,
      pipelineVersion: job.pipelineVersion,
      attempt: job.attempts,
      createdAt: job.createdAt,
    });

    try {
      // Atomic: mark-dispatched and enqueue happen together, so we never
      // consume a dedup slot without the message actually being enqueued.
      const tx = redisClient.multi();
      tx.set(`dispatched:${job._id}:${job.attempts}`, "1", {
        NX: true,
        EX: DISPATCH_DEDUP_TTL_SECONDS,
      });
      tx.lPush(JOB_QUEUE, payload);
      const results = (await tx.exec()) as unknown[];

      if (results[0] !== "OK") {
        // Already dispatched by a previous tick; skip.
        continue;
      }
      dispatched++;
    } catch (err) {
      // Redis unavailable: durable PENDING records remain, next tick retries.
      logger.warn(
        `Job dispatch to Redis failed, will retry: ${(err as Error).message}`,
      );
      break;
    }
  }

  if (dispatched) {
    logger.info(`Dispatched ${dispatched} media job(s) to Redis`);
  }

  return dispatched;
}

export function startMediaJobDispatcherJob(): void {
  const schedule = process.env["DISPATCH_CRON_SCHEDULE"] ?? "* * * * *";

  if (!cron.validate(schedule)) {
    logger.error(`Invalid DISPATCH_CRON_SCHEDULE "${schedule}"`);
    process.exit(1);
  }

  cron.schedule(
    schedule,
    () => void dispatchPendingJobs().catch(() => undefined),
  );

  logger.info(`mediaJobDispatcher job scheduled ("${schedule}")`);
}
