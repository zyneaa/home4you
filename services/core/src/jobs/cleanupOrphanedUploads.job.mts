import { randomUUID } from "crypto";

import { redisClient } from "@config";
import { Media } from "@modules/media/media.model.mjs";
import { mediaService } from "@modules/media/media.service.mjs";
import { logger } from "@utils";
import cron from "node-cron";

// Stale-claim window: a CLEANING record older than this means the cleaner
// crashed between the S3 delete and the DB update (or mid-flight). Those
// records are safely reconciled back to PENDING — S3 deletion is idempotent,
// so a retried DELETE on an already-gone key is a no-op.
const STALE_CLAIM_MINUTES = 15;

const LOCK_KEY = "lock:cleanupOrphanedUploads";
const LOCK_TTL_SECONDS = 5 * 60;

let lockToken = randomUUID();

const RELEASE_LOCK_LUA = `local v = redis.call("GET", KEYS[1])
if v == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

// Distributed coordination: cross-replica exclusion via Redis SET NX EX +
// token compare-and-delete release, so a replica that overran its TTL can
// never release a lock now held by another replica.
async function acquireLock(): Promise<boolean> {
  const ok = await redisClient.set(LOCK_KEY, lockToken, {
    NX: true,
    EX: LOCK_TTL_SECONDS,
  });
  return ok === "OK";
}

async function releaseLock(): Promise<void> {
  await redisClient.eval(RELEASE_LOCK_LUA, {
    keys: [LOCK_KEY],
    arguments: [lockToken],
  });
}

// Crash recovery: flip CLEANING records older than the stale window back to
// PENDING so the next run retries them. Bounded by a single updateMany.
export async function reconcileStaleCleanings(
  staleMinutes = STALE_CLAIM_MINUTES,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const res = await Media.updateMany(
    {
      uploadStatus: "CLEANING",
      updatedAt: { $lt: cutoff },
    },
    { $set: { uploadStatus: "PENDING" } },
  );

  if (res.modifiedCount) {
    logger.info(
      `Reconciled ${res.modifiedCount} stale CLEANING media records back to PENDING`,
    );
  }

  return res.modifiedCount;
}

export async function runCleanupOnce(graceMinutes = 30): Promise<void> {
  // Per-process re-entry guard; cross-process duplication is prevented by
  // the distributed lock. cleanupOrphanedUploads() itself is idempotent and
  // bounds its S3/database work via pLimit and batched queries.
  let hasLock = false;

  try {
    hasLock = await acquireLock();
    if (!hasLock) {
      logger.info("Another replica holds the cleanup lock, skipping run");
      return;
    }

    await reconcileStaleCleanings();

    const result = await mediaService.cleanupOrphanedUploads(graceMinutes);
    logger.info(`Orphaned-upload cleanup done: ${JSON.stringify(result)}`);
  } catch (err) {
    logger.error(`Orphaned-upload cleanup failed: ${(err as Error).message}`);
  } finally {
    if (hasLock) {
      try {
        await releaseLock();
      } catch {
        // Lock expires via TTL anyway.
      }
    }
    // Rotate the token so a released lock can never be freed twice.
    lockToken = randomUUID();
  }
}

export function startCleanupOrphanedUploadsJob(): void {
  const schedule = process.env["CLEANUP_CRON_SCHEDULE"] ?? "*/15 * * * *";
  const graceMinutes = Number(process.env["CLEANUP_GRACE_MINUTES"] ?? 30);

  if (!cron.validate(schedule)) {
    logger.error(`Invalid CLEANUP_CRON_SCHEDULE "${schedule}"`);
    process.exit(1);
  }

  cron.schedule(schedule, () => void runCleanupOnce(graceMinutes));

  // Fire once at boot so a fresh deployment cleans up promptly.
  void runCleanupOnce(graceMinutes);

  logger.info(
    `cleanupOrphanedUploads job scheduled ("${schedule}", grace ${graceMinutes}m)`,
  );
}
