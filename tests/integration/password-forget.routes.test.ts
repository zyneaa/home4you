import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.mjs";
import { passwordForgetService } from "../../src/modules/password-forget/password-forget.service.mjs";

vi.mock("../../src/modules/password-forget/password-forget.service.mjs");
vi.mock("../../src/middlewares/signHMAC.middleware.mjs", () => ({
  requestSigningGuard: (req, res, next) => next(),
}));

describe("Password Forget Routes Integration [Supertest]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/auth/forgot-password", () => {
    // Note: route might be under /auth or /password-forget?
    // Checking src/routes/v1.routes.mts:
    // routerV1.use("/password-forget", globalRateLimit, requestSigningGuard, passwordForgetRoutes);
    // So it is /api/v1/password-forget/forgot-password likely
    // Let's verify src/modules/password-forget/password-forget.routes.mts
    // router.post("/forgot-password", ...)
    // So full path: /api/v1/password-forget/forgot-password

    it("should send OTP", async () => {
      (passwordForgetService.forgotPassword as any).mockResolvedValue(
        "OTP sent",
      );

      const res = await request(app)
        .post("/api/v1/password-forget/forgot-password")
        .send({ email: "test@example.com" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: "OTP sent" });
    });
  });

  describe("POST /api/v1/password-forget/reset-password", () => {
    it("should reset password", async () => {
      (passwordForgetService.resetPassword as any).mockResolvedValue(
        "Password reset successful",
      );

      const res = await request(app)
        .post("/api/v1/password-forget/reset-password")
        .send({
          email: "test@example.com",
          otp: "123456",
          newPassword: "NewPass123@",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: "Password reset successful" });
    });
  });
});
