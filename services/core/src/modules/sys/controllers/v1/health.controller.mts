import { redisClient } from "@config";
import type { Request, Response } from "express";
import mongoose from "mongoose";

/**
 * Checks the current connection status of the Redis client.
 * Logic flow:
 * 1. Verifies if the redisClient is initialized.
 * 2. Checks if the client is currently open/connected.
 * 3. Returns a descriptive status string based on the connection state and potential errors.
 */
export const getRedisStatus = async (): Promise<string> => {
  if (!redisClient) {
    return "uninitialized";
  }

  const status = redisClient.isOpen ? "connected" : "disconnected";
  if (status === "connected") {
    try {
      return "connected";
    } catch (error) {
      return `connected but failed LIVENESS check (Error: ${(error as Error).message})`;
    }
  }

  return `disconnected (Current State: ${redisClient.options?.socket?.connectTimeout ? "connecting" : "not attempted"})`;
};

/**
 * Endpoint handler to check the overall system health, including database and cache dependencies.
 * Logic flow:
 * 1. Initializes a health report object with uptime and timestamp.
 * 2. Determines the MongoDB connection state using mongoose.
 * 3. Retrieves the Redis connection status via getRedisStatus.
 * 4. Sets the overall status to 'OK' if all dependencies are connected, otherwise 'ERROR'.
 * 5. Returns the health report with a 200 status (healthy) or 503 status (unhealthy).
 */
export const checkHealth = async (_: Request, res: Response): Promise<void> => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: "OK",
    dependencies: {
      mongo: "unknown",
      redis: "unknown",
    },
  };

  try {
    const mongoState = mongoose.connection.readyState;
    health.dependencies.mongo =
      mongoState === 1
        ? "connected"
        : mongoState === 2
          ? "connecting"
          : "disconnected";

    health.dependencies.redis = await getRedisStatus();

    const allHealthy = Object.values(health.dependencies).every(
      s => s === "connected",
    );
    health.status = allHealthy ? "OK" : "ERROR";

    const statusCode = allHealthy ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (err) {
    health.status = "ERROR";
    res.status(503).json({
      ...health,
      error: (err as Error).message,
    });
  }
};
