import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.mjs";
import mongoose from "mongoose";
import { redisClient } from "../../src/config/redis.mjs";

// Mock dependencies
vi.mock("../../src/config/redis.mjs");

// Mock HMAC for health check? Usually health check is public and rate limited but maybe not HMAC protected?
// Looking at v1.routes.mts:
// routerV1.use("/sys", globalRateLimit, v1SysRoutes);
// It is NOT protected by requestSigningGuard (which is used for auth/password/user/property)
// So we don't need to mock HMAC here.

describe("Health Routes Integration [Supertest]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/sys/health", () => {
    it("should return 200 OK when all services are healthy", async () => {
      // Mock Mongoose connected
      Object.defineProperty(mongoose.connection, "readyState", {
        value: 1,
        configurable: true,
      });

      // Mock Redis connected
      (redisClient as any).isOpen = true;

      const res = await request(app).get("/api/v1/sys/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("OK");
      expect(res.body.dependencies.mongo).toBe("connected");
      expect(res.body.dependencies.redis).toBe("connected");
    });

    it("should return 503 if any service is down", async () => {
      // Mock Mongoose disconnected
      Object.defineProperty(mongoose.connection, "readyState", {
        value: 0,
        configurable: true,
      });

      const res = await request(app).get("/api/v1/sys/health");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("ERROR");
    });
  });
});
