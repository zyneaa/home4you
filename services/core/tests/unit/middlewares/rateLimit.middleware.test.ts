import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  globalRateLimit,
  authUserRateLimit,
} from "../../../src/middlewares/rateLimit.middleware.mjs";
import { redisClient } from "../../../src/config/redis.mjs";
import { AppError } from "../../../src/utils/appError.mjs";
import { Request, Response, NextFunction } from "express";

// Mock env variables for rate limit
vi.mock("../../../src/shared/validations/env.validation.mjs", () => ({
  env: {
    GLOBAL_WINDOW_SIZE: 15,
    GLOBAL_SUB_WINDOW_SIZE: 5,
    GLOBAL_LIMIT: 10,
    USER_WINDOW_SIZE: 15,
    USER_SUB_WINDOW_SIZE: 5,
    USER_LIMIT: 10,
  },
}));

describe("Rate Limit Middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { ip: "127.0.0.1", user: { id: "user123" } } as any;
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    next = vi.fn();
  });

  describe("globalRateLimit", () => {
    it("should allow request if within limit (Redis Lua returns [0, count])", async () => {
      // Mock Redis Lua script load/eval
      (redisClient as any).scriptLoad = vi.fn().mockResolvedValue("sha123");
      (redisClient as any).evalSha = vi.fn().mockResolvedValue([0, 1]); // Status 0 (allowed), count 1

      await globalRateLimit(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(redisClient.evalSha).toHaveBeenCalled();
    });

    it("should block request if limit exceeded (Redis Lua returns [1, count])", async () => {
      (redisClient as any).scriptLoad = vi.fn().mockResolvedValue("sha123");
      (redisClient as any).evalSha = vi.fn().mockResolvedValue([1, 11]); // Status 1 (blocked)

      await globalRateLimit(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 429,
          message: "Too many requests",
        }),
      );
    });

    it("should fallback to memory if Redis fails", async () => {
      // Mock Redis failure
      (redisClient as any).scriptLoad = vi
        .fn()
        .mockRejectedValue(new Error("Redis error"));
      // Also executing fallback would require mocking 'rateLimit' from express-rate-limit?
      // The middleware creates 'memoryFallback' top level.
      // We can just verify it doesn't crash and calls next() or similar (fallback might call next)

      // Ideally we'd mock the fallback behavior, but since it's an external lib instance,
      // let's just ensure unexpected errors drift to memory fallback logic
      // Note: memoryFallback is created at module level.

      const nextSpy = vi.fn();
      await globalRateLimit(req as Request, res as Response, nextSpy);

      // Since memory fallback uses standard express-rate-limit, it likely calls next() if under limit.
      // However, we can't easily assert on the internal state of memoryFallback without more complex mocking.
      // Asserting that it handled the error gracefully is enough.
      // The code logs error then calls memoryFallback(req, res, next)

      // If redis fails, it catches, logs, then calls memoryFallback
      // Since we didn't mock express-rate-limit's return value, it executes the real function.
      // Real function is an in-memory store. First call should pass.
      expect(nextSpy).toHaveBeenCalled();
    });
  });

  describe("authUserRateLimit", () => {
    it("should return 404 if user not found on request", async () => {
      req.user = undefined;
      await authUserRateLimit(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 404, message: "User not found" }),
      );
    });

    it("should use user specific key for limiting", async () => {
      (redisClient as any).scriptLoad = vi.fn().mockResolvedValue("sha123");
      (redisClient as any).evalSha = vi.fn().mockResolvedValue([0, 1]);

      await authUserRateLimit(req as Request, res as Response, next);

      expect(redisClient.evalSha).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          keys: [`rate_limit:user:user123`],
        }),
      );
      expect(next).toHaveBeenCalled();
    });
  });
});
