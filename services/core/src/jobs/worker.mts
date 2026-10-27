import "../utils/logger.mjs";
import "../shared/validations/env.validation.mjs"; // Validate environment first

import { connectDB, redisClient } from "@config";
import { logger } from "@utils";

import {
  runCleanupOnce,
  startCleanupOrphanedUploadsJob,
} from "./cleanupOrphanedUploads.job.mjs";
import { startMediaJobDispatcherJob } from "./mediaJobDispatcher.job.mjs";

const bootstrap = async (): Promise<void> => {
  // The job only touches the database and S3 after DB init succeeded.
  await connectDB();

  try {
    await redisClient.connect();
  } catch {
    // Redis unavailable: run without the distributed lock (fine for
    // single-replica deployments) rather than dying.
    logger.warn("Redis unavailable — running without distributed lock");
  }

  startCleanupOrphanedUploadsJob();
  startMediaJobDispatcherJob();
};

bootstrap().catch(err => {
  logger.error(`Cleanup worker failed to start: ${(err as Error).message}`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down cleanup worker`);
    process.exit(0);
  });
}

process.on("unhandledRejection", reason => {
  logger.error(`Unhandled rejection in cleanup worker: ${reason}`);
});

// Keep the module referenced for programmatic use (tests/scripts).
export { runCleanupOnce };
