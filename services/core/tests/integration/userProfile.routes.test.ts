import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.mjs";
import { userProfileService } from "../../src/modules/user-profile/userProfile.service.mjs";
import { jwtToken } from "../../src/utils/index.mjs";
import { redisClient } from "../../src/config/redis.mjs";
import { User } from "../../src/modules/user/user.model.mjs";

// Mock Services
vi.mock("../../src/modules/user-profile/userProfile.service.mjs");

// Mock Auth Dependencies
vi.mock("../../src/utils/index.mjs", async () => {
  const actual = await vi.importActual("../../src/utils/index.mjs");
  return {
    ...(actual as any),
    jwtToken: { verify: vi.fn() },
  };
});
vi.mock("../../src/config/redis.mjs");
vi.mock("../../src/modules/user/user.model.mjs");
vi.mock("../../src/middlewares/signHMAC.middleware.mjs", () => ({
  requestSigningGuard: (req, res, next) => next(),
}));

describe("User Profile Routes Integration [Supertest]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (jwtToken.verify as any).mockReturnValue({ userId: "u1", jti: "valid" });
    (redisClient.get as any).mockResolvedValue(null);
    (User.findById as any).mockResolvedValue({ id: "u1", emailVerified: true });
  });

  describe("GET /api/v1/user-profile/me", () => {
    it("should return my profile", async () => {
      const mockProfile = { userId: "u1", bio: "My Bio" };
      (userProfileService.getProfile as any).mockResolvedValue(mockProfile);

      const res = await request(app)
        .get("/api/v1/user-profile/me")
        .set("Authorization", "Bearer valid_token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockProfile);
    });
  });

  describe("PATCH /api/v1/user-profile/me", () => {
    it("should update profile", async () => {
      const mockProfile = { userId: "u1", bio: "Updated" };
      (userProfileService.updateProfile as any).mockResolvedValue(mockProfile);

      const res = await request(app)
        .patch("/api/v1/user-profile/me")
        .set("Authorization", "Bearer valid_token")
        .send({ bio: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockProfile);
    });
  });
});
