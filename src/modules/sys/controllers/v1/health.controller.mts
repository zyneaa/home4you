import { redisClient } from "@config";
import type { Request, Response } from "express";
import mongoose from "mongoose";

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
