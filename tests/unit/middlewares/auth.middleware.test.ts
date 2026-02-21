import { describe, it, expect, vi, beforeEach } from "vitest";
import { protect } from "../../../src/middlewares/auth.middleware.mjs";
import { redisClient } from "../../../src/config/redis.mjs";
import { User } from "../../../src/modules/user/user.model.mjs";
import { jwtToken } from "../../../src/utils/index.mjs";
import { AppError } from "../../../src/utils/appError.mjs";
import { Request, Response, NextFunction } from "express";

// Mock User model
vi.mock("../../../src/modules/user/user.model.mjs", () => ({
  User: {
    findById: vi.fn(),
  },
}));

// Mock Redis if setup.ts fails
vi.mock("../../../src/config/redis.mjs", () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
    isOpen: true,
  },
}));

// Mock jwtToken util
vi.mock("../../../src/utils/index.mjs", async () => {
  const actual = await vi.importActual("../../../src/utils/index.mjs");
  return {
    ...(actual as any),
    jwtToken: {
      verify: vi.fn(),
    },
  };
});

describe("Auth Middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
    } as any;
    res = {} as any;
    next = vi.fn();
  });

  it("should return 401 if authorization header is missing", async () => {
    await protect(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        message: expect.stringContaining("No Token found"),
      }),
    );
  });

  it("should return 401 if token is invalid/expired", async () => {
    req.headers = { authorization: "Bearer invalid.token" };
    (jwtToken.verify as any).mockImplementation(() => {
      throw new Error("Invalid token");
    });

    await protect(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("should return 401 if token is blacklisted (revoked)", async () => {
    req.headers = { authorization: "Bearer revoked.token" };
    (jwtToken.verify as any).mockReturnValue({
      userId: "user123",
      jti: "revoked-jti",
    });
    // Mock Redis returning a value (meaning blacklisted)
    (redisClient.get as any).mockResolvedValue("blacklisted");

    await protect(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        message: expect.stringContaining("revoked"),
      }),
    );
  });

  it("should return 401 if user does not exist", async () => {
    req.headers = { authorization: "Bearer valid.token" };
    (jwtToken.verify as any).mockReturnValue({
      userId: "user123",
      jti: "valid-jti",
    });
    (redisClient.get as any).mockResolvedValue(null);
    (User.findById as any).mockResolvedValue(null);

    await protect(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, message: "User not found" }),
    );
  });

  it("should return 401 if user email is not verified", async () => {
    req.headers = { authorization: "Bearer valid.token" };
    (jwtToken.verify as any).mockReturnValue({
      userId: "user123",
      jti: "valid-jti",
    });
    (redisClient.get as any).mockResolvedValue(null);
    (User.findById as any).mockResolvedValue({
      id: "user123",
      emailVerified: false,
    });

    await protect(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        message: "Email is not verified",
      }),
    );
  });

  it("should call next() and attach user to req if everything is valid", async () => {
    req.headers = { authorization: "Bearer valid.token" };
    const mockUser = { id: "user123", emailVerified: true };
    (jwtToken.verify as any).mockReturnValue({
      userId: "user123",
      jti: "valid-jti",
    });
    (redisClient.get as any).mockResolvedValue(null);
    (User.findById as any).mockResolvedValue(mockUser);

    await protect(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBe(mockUser);
  });
});
