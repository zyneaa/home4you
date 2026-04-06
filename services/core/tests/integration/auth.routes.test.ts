import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.mjs";
import { authService } from "../../src/modules/auth/auth.service.mjs";
import { otpCodeService } from "../../src/modules/otp-code/otpCode.service.mjs";

// Mock Services
vi.mock("../../src/modules/auth/auth.service.mjs");
vi.mock("../../src/modules/otp-code/otpCode.service.mjs");

// Mock middlewares that might block requests or behave complexly
// We want to test that the route CALLS the controller, and controller CALLS the service.
// Rate limiting is mocked in setup.ts via redis mock (it won't block unless we force it)
// HMAC signature guard is enabled in app.mts. We might need to mock it or provide valid headers.
// Since HMAC middleware logic is complex (timestamp, nonce, redis), for integration tests of *business logic*,
// it is better to mock the HMAC middleware to always pass, OR provide a helper to generate valid headers.
// Let's mock the keys middleware for now to focus on Auth logic, or implement a generator.
// Given "comprehensive tests", testing with valid headers is better. But mocking utils/krypto is easier.

vi.mock("../../src/middlewares/signHMAC.middleware.mjs", () => ({
  requestSigningGuard: (req, res, next) => next(),
}));

describe("Auth Routes Integration [Supertest]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/auth/register", () => {
    it("should register a user successfully", async () => {
      (authService.register as any).mockResolvedValue("OTP sent");

      const res = await request(app).post("/api/v1/auth/register").send({
        email: "test@example.com",
        userName: "testuser",
        password: "Password123@",
        deviceId: "d1",
        channel: "EMAIL",
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: "OTP sent" });
      expect(authService.register).toHaveBeenCalled();
    });

    it("should return 400 for invalid input", async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        email: "invalid-email",
        // missing fields
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Validation failed/);
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("should login successfully", async () => {
      (authService.login as any).mockResolvedValue("OTP sent");

      const res = await request(app).post("/api/v1/auth/login").send({
        email: "test@example.com",
        password: "Password123@",
        deviceId: "d1",
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: "OTP sent" });
    });
  });

  describe("POST /api/v1/auth/refresh", () => {
    it("should refresh tokens", async () => {
      (authService.refresh as any).mockResolvedValue({
        accessToken: "new_at",
        refreshToken: "new_rt",
      });

      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Authorization", "RefreshToken old_rt")
        .send({ deviceId: "d1" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accessToken: "new_at",
        refreshToken: "new_rt",
      });
    });

    it("should return 401 if refresh token header is missing", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ deviceId: "d1" });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/auth/logout", () => {
    it("should logout successfully", async () => {
      const res = await request(app)
        .post("/api/v1/auth/logout")
        .set("Authorization", "Bearer valid_at")
        .send({ deviceId: "d1", refreshToken: "rt" });

      expect(res.status).toBe(204);
      expect(authService.logout).toHaveBeenCalled();
    });
  });
});
