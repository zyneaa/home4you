import { initRedis, connectDB, redisClient } from "@config";
import { env } from "@shared/validations";
import { logger } from "@utils";
import mongoose from "mongoose";

import app from "./app.mjs";

let server;

const PORT = env.PORT;
let shuttingDown = false;

try {
  await Promise.all([connectDB(), initRedis()]);

  logger.info("All dependencies initialized. Starting server...");
  server = app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
  });
} catch (err) {
  logger.error("App startup failed:", err);
  process.exit(1);
}

const shutdown = async (signal: string): Promise<void> => {
  setTimeout(() => {
    logger.error("Force exiting after 30s timeout");
    process.exit(1);
  }, 30_000).unref();

  if (shuttingDown) {
    logger.warn(`Already shutting down, ignoring ${signal}`);
    return;
  }

  shuttingDown = true;
  logger.warn(`Received ${signal}. Starting graceful shutdown...`);

  try {
    logger.info("Stopping new incoming connections...");
    await new Promise<void>(resolve => {
      server.close(() => {
        logger.info("HTTP server closed");
        resolve();
      });
    });

    if (redisClient.isOpen) {
      logger.info("Closing Redis connection...");
      try {
        await redisClient.quit();
        logger.info("Redis connection closed successfully");
      } catch (err) {
        logger.error(`Error closing Redis: ${(err as Error).message}`);
      }
    }

    if (mongoose.connection.readyState === 1) {
      logger.info("Closing MongoDB connection...");
      try {
        await mongoose.connection.close();
        logger.info("MongoDB connection closed successfully");
      } catch (err) {
        logger.error(`Error closing MongoDB: ${(err as Error).message}`);
      }
    }

    logger.info("Gracefully shutdown!");
    process.exit(0);
  } catch (err) {
    logger.error(`Error during shutdown: ${(err as Error).message}`);
    process.exit(1);
  }
};

// shutdown signals
["SIGINT", "SIGTERM", "SIGQUIT"].forEach(sig => {
  process.on(sig as NodeJS.Signals, () => shutdown(sig));
});

process.on("uncaughtException", err => {
  logger.error(`Uncaught Exception: ${err.message}`);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", reason => {
  logger.error(`Unhandled Rejection: ${reason}`);
  shutdown("unhandledRejection");
});
