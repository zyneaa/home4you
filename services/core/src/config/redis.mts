import { env } from "@shared/validations";
import { logger } from "@utils";
import { createClient } from "redis";

export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: retries => {
      const delay = Math.min(retries * 100, 3000); // capped exponential backoff
      logger.warn(
        `Redis reconnect attempt #${retries}, retrying in ${delay}ms`,
      );
      return delay;
    },
  },
});

export const initRedis = async (): Promise<void> => {
  try {
    await redisClient.connect();
    logger.info("Redis client initialized successfully");
  } catch (err) {
    logger.error("Failed to connect to Redis:", err);
    throw err;
  }
};
