import { describe, it, expect, vi, beforeEach } from "vitest";

import { passwordForgetService } from "../../../src/modules/password-forget/password-forget.service.mjs";
import { User } from "../../../src/modules/user/user.model.mjs";
import { OtpCode } from "../../../src/modules/otp-code/otpCode.model.mjs";
import { otpCodeService } from "../../../src/modules/otp-code/otpCode.service.mjs";
import mongoose from "mongoose";
import argon2 from "argon2";

vi.mock("mongoose", async () => {
  const actual = await vi.importActual("mongoose");
  return {
    ...(actual as any),
    startSession: vi.fn(),
  };
});
vi.mock("argon2");
vi.mock("../../../src/modules/user/user.model.mjs");
vi.mock("../../../src/modules/otp-code/otpCode.model.mjs");
vi.mock("../../../src/modules/otp-code/otpCode.service.mjs");

describe("Password Forget Service", () => {
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      withTransaction: vi.fn(cb => cb()),
      endSession: vi.fn(),
      abortTransaction: vi.fn(),
      inTransaction: vi.fn().mockReturnValue(false),
    };
    (mongoose.startSession as any).mockResolvedValue(mockSession);
  });

  describe("forgotPassword", () => {
    it("should generate and send OTP if user exists", async () => {
      const mockUser = { id: "u1", email: "test@example.com" };
      (User.findOne as any).mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      (otpCodeService.generateOtp as any).mockResolvedValue("123456");

      await passwordForgetService.forgotPassword({ email: "test@example.com" });

      expect(otpCodeService.createAndSetOtp).toHaveBeenCalled();
      expect(otpCodeService.sendOtp).toHaveBeenCalledWith(
        "test@example.com",
        "123456",
      );
    });
  });

  describe("resetPassword", () => {
    it("should reset password if OTP is valid", async () => {
      const mockUser = { id: "u1", setPassword: vi.fn(), save: vi.fn() };
      const mockUserQuery = {
        select: vi.fn().mockReturnThis(),
        session: vi.fn().mockResolvedValue(mockUser),
      };
      (User.findOne as any).mockReturnValue(mockUserQuery);

      const mockOtp = {
        _id: "otp1",
        codeHash: "hash",
        expiresAt: new Date(Date.now() + 10000),
      };
      const mockOtpQuery = {
        select: vi.fn().mockReturnThis(),
        session: vi.fn().mockResolvedValue(mockOtp),
      };
      (OtpCode.findOne as any).mockReturnValue(mockOtpQuery);

      (argon2.verify as any).mockResolvedValue(true);
      (OtpCode.deleteOne as any).mockResolvedValue({});

      await passwordForgetService.resetPassword({
        email: "test@example.com",
        otp: "123456",
        newPassword: "NewPass",
      });

      expect(mockUser.setPassword).toHaveBeenCalledWith("NewPass");
      expect(mockUser.save).toHaveBeenCalled();
    });
  });
});
