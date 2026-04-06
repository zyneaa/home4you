import { env } from "@shared/validations";
import { logger } from "@utils";
import mongoose from "mongoose";

export const connectDB = async (): Promise<void> => {
  const MAX_RETRIES = 10; // Set these as env vars later
  const RETRY_DELAY = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const conn = await mongoose.connect(env.DATABASE_URL, {
        replicaSet: env.DATABASE_REPLICA_SET,
        maxPoolSize:
          env.NODE_ENV === "production" ? env.MONGO_MAX_POOL_SIZE : 10,
        minPoolSize:
          env.NODE_ENV === "production" ? env.MONGO_MIN_POOL_SIZE : 2,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false,
        retryWrites: true,
        retryReads: true,
        compressors: ["zlib"],
        heartbeatFrequencyMS: 10000,
      });

      logger.info(
        `MongoDB connected to ${conn.connection.host} (attempt ${attempt})`,
      );

      break;
    } catch (err: any) {
      logger.warn(
        `MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`,
      );

      if (attempt === MAX_RETRIES) {
        logger.error("MongoDB connection failed after max retries. Exiting.");
        process.exit(1);
      }

      await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
  }

  // --- RUNTIME RESILIENCE ---
  const db = mongoose.connection;

  db.on("error", err => {
    logger.error(`Mongoose runtime error: ${err.message}`);
  });

  db.on("disconnected", () => {
    logger.warn("Mongoose disconnected! Auto-reconnect in progress...");
  });

  db.on("reconnected", () => {
    logger.info("Mongoose reconnected successfully!");
  });
};
