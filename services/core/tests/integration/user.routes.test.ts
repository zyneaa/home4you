import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.mjs";
import { userService } from "../../src/modules/user/user.service.mjs";
import { jwtToken } from "../../src/utils/index.mjs";
import { redisClient } from "../../src/config/redis.mjs";
import { User } from "../../src/modules/user/user.model.mjs";

// Mock Services
vi.mock("../../src/modules/user/user.service.mjs");

// Mock Middleware dependencies for Auth
vi.mock("../../src/utils/index.mjs", async () => {
  const actual = await vi.importActual("../../src/utils/index.mjs");
  return {
    ...(actual as any),
    jwtToken: {
      verify: vi.fn(),
    },
  };
});
vi.mock("../../src/config/redis.mjs", () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    isOpen: true,
  },
}));
vi.mock("../../src/modules/user/user.model.mjs");

// Mock HMAC
vi.mock("../../src/middlewares/signHMAC.middleware.mjs", () => ({
  requestSigningGuard: (req, res, next) => next(),
}));

describe("User Routes Integration [Supertest]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default auth success
    (jwtToken.verify as any).mockReturnValue({
      userId: "user123",
      jti: "valid",
    });
    (redisClient.get as any).mockResolvedValue(null); // not blacklisted
    (User.findById as any).mockResolvedValue({
      id: "user123",
      emailVerified: true,
    });
  });

  describe("GET /api/v1/user/:id", () => {
    it("should return user details", async () => {
      const mockUser = { id: "user123", userName: "test" };
      (userService.getUserById as any).mockResolvedValue({
        toJSON: () => mockUser,
      });

      const res = await request(app)
        .get("/api/v1/user/user123")
        .set("Authorization", "Bearer valid_token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockUser);
    });
  });

  describe("PATCH /api/v1/user/:id", () => {
    it("should update user details", async () => {
      const mockUser = { id: "user123", userName: "updated" };
      (userService.updateUser as any).mockResolvedValue({
        toJSON: () => mockUser,
      });

      const res = await request(app)
        .patch("/api/v1/user/user123")
        .set("Authorization", "Bearer valid_token")
        .send({ userName: "updated" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockUser);
    });

    it("should return 400 for invalid email in update", async () => {
      const res = await request(app)
        .patch("/api/v1/user/user123")
        .set("Authorization", "Bearer valid_token")
        .send({ email: "invalid-email" });

      expect(res.status).toBe(400);
    });
  });
});
