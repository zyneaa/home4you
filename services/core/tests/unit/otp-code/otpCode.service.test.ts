import { describe, it, expect, vi, beforeEach } from "vitest";

import { otpCodeService } from "../../../src/modules/otp-code/otpCode.service.mjs";
import { OtpCode } from "../../../src/modules/otp-code/otpCode.model.mjs";
import { redisClient } from "../../../src/config/redis.mjs";
import { transporter } from "../../../src/config/mailer.mjs";
import { AppError } from "../../../src/utils/appError.mjs";
import argon2 from "argon2";
import mongoose from "mongoose";

// Mock dependencies
vi.mock("argon2");
vi.mock("mongoose");
vi.mock("../../../src/modules/otp-code/otpCode.model.mjs");
vi.mock("../../../src/config/redis.mjs", () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
    isOpen: true,
  },
}));
vi.mock("../../../src/config/mailer.mjs", () => ({
  transporter: {
    sendMail: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("crypto", () => ({
  randomInt: vi.fn().mockReturnValue(123456),
}));

// Mock authService
vi.mock("../../../src/modules/auth/auth.service.mjs", () => ({
  authService: {
    createSession: vi.fn(),
    lockAccount: vi.fn(),
  },
}));

import { authService } from "../../../src/modules/auth/auth.service.mjs";
import { User } from "../../../src/modules/user/user.model.mjs";

vi.mock("../../../src/modules/user/user.model.mjs");

describe("OTP Code Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateOtp", () => {
    it("should return a 6 digit code", async () => {
      const otp = await otpCodeService.generateOtp(6);
      expect(otp).toHaveLength(6);
    });
  });

  describe("createAndSetOtp", () => {
    it("should create and save OTP", async () => {
      (argon2.hash as any).mockResolvedValue("hash");
      (OtpCode.create as any).mockResolvedValue([]);
      (OtpCode.deleteMany as any).mockResolvedValue({});

      // session is 5th arg
      const mockSession = {} as any;
      await otpCodeService.createAndSetOtp(
        "u1",
        "123456",
        "LOGIN" as any,
        "EMAIL" as any,
        mockSession,
      );

      expect(OtpCode.create).toHaveBeenCalled();
    });
  });

  describe("verifyOtp", () => {
    it("should verify valid OTP and return tokens", async () => {
      const mockUser = {
        id: "u1",
        email: "test@example.com",
        emailVerified: true,
        save: vi.fn(),
        toJSON: vi.fn().mockReturnValue({ id: "u1" }),
      };
      const mockOtpDoc = {
        _id: "otp1",
        codeHash: "hash",
        expiresAt: new Date(Date.now() + 10000),
        isUsed: false,
        userId: "u1",
        type: "LOGIN",
      };

      // Mock Mongoose session start
      const mockSession = {
        startTransaction: vi.fn(),
        commitTransaction: vi.fn(),
        abortTransaction: vi.fn(),
        endSession: vi.fn(),
        inTransaction: vi.fn().mockReturnValue(true),
      };
      (mongoose.startSession as any) = vi.fn().mockResolvedValue(mockSession);

      // Mock User findOne
      (User.findOne as any).mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      // Mock OtpCode findOne
      (OtpCode.findOne as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        session: vi.fn().mockResolvedValue(mockOtpDoc),
      });

      (argon2.verify as any).mockResolvedValue(true);
      (OtpCode.deleteOne as any).mockResolvedValue({});

      (authService.createSession as any).mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      const result = await otpCodeService.verifyOtp(
        "test@example.com",
        "123456",
        "LOGIN" as any,
        "ip",
        "agent",
        "device",
      );

      expect(result).toHaveProperty("accessToken", "at");
      expect(result).toHaveProperty("refreshToken", "rt");
    });

    it("should throw if OTP not found or invalid", async () => {
      const mockSession = {
        startTransaction: vi.fn(),
        commitTransaction: vi.fn(),
        abortTransaction: vi.fn(),
        endSession: vi.fn(),
        inTransaction: vi.fn().mockReturnValue(true),
      };
      (mongoose.startSession as any) = vi.fn().mockResolvedValue(mockSession);
      (User.findOne as any).mockReturnValue({
        session: vi.fn().mockResolvedValue({ id: "u1" }),
      });

      // Mock OtpCode findOne returns null
      (OtpCode.findOne as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        session: vi.fn().mockResolvedValue(null),
      });

      await expect(
        otpCodeService.verifyOtp(
          "test@example.com",
          "123456",
          "LOGIN" as any,
          "ip",
          "agent",
          "d",
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe("resendOtp", () => {
    it("should throw if rate limited", async () => {
      const mockSession = {
        startTransaction: vi.fn(),
        commitTransaction: vi.fn(),
        abortTransaction: vi.fn(),
        endSession: vi.fn(),
        inTransaction: vi.fn(),
      };
      (mongoose.startSession as any) = vi.fn().mockResolvedValue(mockSession);
      (redisClient.set as any).mockResolvedValue(null);

      await expect(
        otpCodeService.resendOtp("email", "LOGIN" as any, "EMAIL" as any),
      ).rejects.toThrow(AppError);
    });

    it("should send new OTP if allowed", async () => {
      const mockSession = {
        startTransaction: vi.fn(),
        commitTransaction: vi.fn(),
        abortTransaction: vi.fn(),
        endSession: vi.fn(),
        inTransaction: vi.fn(),
      };
      (mongoose.startSession as any) = vi.fn().mockResolvedValue(mockSession);

      (redisClient.set as any).mockResolvedValue("OK");
      (User.findOne as any).mockReturnValue({
        session: vi.fn().mockResolvedValue({ id: "u1" }),
      });

      (OtpCode.create as any).mockResolvedValue([]);
      (OtpCode.deleteMany as any).mockResolvedValue({});
      (argon2.hash as any).mockResolvedValue("hash");

      // Mock generateOtp
      vi.spyOn(otpCodeService, "generateOtp").mockResolvedValue("123456");
      vi.spyOn(otpCodeService, "createAndSetOtp").mockResolvedValue({
        otp: "123456",
        expiresAt: new Date(),
      });
      vi.spyOn(otpCodeService, "sendOtp").mockResolvedValue();

      await otpCodeService.resendOtp("email", "LOGIN" as any, "EMAIL" as any);

      expect(otpCodeService.sendOtp).toHaveBeenCalled();
    });
  });
});
