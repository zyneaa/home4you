import { describe, it, expect, vi, beforeEach } from "vitest";

import { authService } from "../../../src/modules/auth/auth.service.mjs";
import { User } from "../../../src/modules/user/user.model.mjs";
import { AuthSession } from "../../../src/modules/auth/auth.model.mjs";
import { otpCodeService } from "../../../src/modules/otp-code/otpCode.service.mjs";
import { userService } from "../../../src/modules/user/user.service.mjs";
import { UserProfile } from "../../../src/modules/user-profile/userProfile.model.mjs";
import { AppError } from "../../../src/utils/appError.mjs";
import { jwtToken } from "../../../src/utils/index.mjs";
import mongoose from "mongoose";
import argon2 from "argon2";
import { redisClient } from "../../../src/config/redis.mjs";

// Mock external dependencies
vi.mock("argon2");
vi.mock("mongoose", async () => {
  const actual = await vi.importActual("mongoose");
  return {
    ...(actual as any),
    startSession: vi.fn(),
    Types: {
      ObjectId: class {
        toString() {
          return "mock_id";
        }
      },
    },
  };
});

vi.mock("../../../src/modules/user/user.model.mjs");
vi.mock("../../../src/modules/auth/auth.model.mjs");
vi.mock("../../../src/modules/otp-code/otpCode.service.mjs");
vi.mock("../../../src/modules/user/user.service.mjs");
vi.mock("../../../src/modules/user-profile/userProfile.model.mjs");
vi.mock("../../../src/utils/index.mjs", async () => {
  const actual = await vi.importActual("../../../src/utils/index.mjs");
  return {
    ...(actual as any),
    jwtToken: {
      sign: vi.fn(),
      verify: vi.fn(),
    },
  };
});
vi.mock("../../../src/config/redis.mjs");

describe("Auth Service", () => {
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSession = {
      withTransaction: vi.fn(cb => cb()),
      inTransaction: vi.fn().mockReturnValue(false),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      endSession: vi.fn(),
    };
    (mongoose.startSession as any) = vi.fn().mockResolvedValue(mockSession);
  });

  describe("register", () => {
    it("should register a new user using EMAIL channel", async () => {
      const dto = {
        email: "test@example.com",
        password: "Password123",
        userName: "testuser",
        channel: "EMAIL",
        deviceId: "device123",
      } as any;

      const mockUser = { id: "user123" };
      (userService.createUser as any).mockResolvedValue(mockUser);
      (otpCodeService.generateOtp as any).mockResolvedValue("123456");
      (UserProfile.create as any).mockResolvedValue([]);

      const result = await authService.register(dto);

      expect(userService.createUser).toHaveBeenCalledWith(dto, mockSession);
      expect(UserProfile.create).toHaveBeenCalled();
      expect(otpCodeService.createAndSetOtp).toHaveBeenCalledWith(
        "user123",
        "123456",
        expect.anything(), // OtpType.SIGNUP
        expect.anything(), // Channel.EMAIL
        mockSession,
      );
      expect(otpCodeService.sendOtp).toHaveBeenCalledWith(dto.email, "123456");
      expect(result).toContain("OTP has been sent");
    });
  });

  describe("login", () => {
    it("should login successfully and send OTP", async () => {
      const dto = {
        email: "test@example.com",
        password: "Password123",
        deviceId: "device123",
      };

      const mockUser = {
        id: "user123",
        passwordHash: "hashedPassword",
        lockUntil: null,
        email: "test@example.com",
        failedLoginAttempts: 0,
        save: vi.fn(),
      };

      // Mock findOne chain
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        session: vi.fn().mockResolvedValue(mockUser),
      };
      (User.findOne as any).mockReturnValue(mockQuery);

      (argon2.verify as any).mockResolvedValue(true);
      (otpCodeService.generateOtp as any).mockResolvedValue("654321");

      const result = await authService.login(dto);

      expect(argon2.verify).toHaveBeenCalledWith(
        "hashedPassword",
        "Password123",
      );
      expect(otpCodeService.createAndSetOtp).toHaveBeenCalled();
      expect(otpCodeService.sendOtp).toHaveBeenCalledWith(dto.email, "654321");
    });

    it("should throw error for invalid credentials", async () => {
      const mockUser = {
        id: "user123",
        passwordHash: "hashedPassword",
        save: vi.fn(),
        failedLoginAttempts: 0,
      };
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        session: vi.fn().mockResolvedValue(mockUser),
      };
      (User.findOne as any).mockReturnValue(mockQuery);
      (argon2.verify as any).mockResolvedValue(false);

      await expect(
        authService.login({
          email: "test@example.com",
          password: "Wrong",
          deviceId: "d",
        }),
      ).rejects.toThrow(AppError);

      // check failed attempts increment logic if lockAccount is called (implicit)
    });
  });

  describe("logout", () => {
    it("should logout successfully", async () => {
      (jwtToken.verify as any).mockReturnValue({
        jti: "jti123",
        exp: Date.now() / 1000 + 3600,
      });

      const mockSessionDoc = {
        _id: "session123",
        tokenHash: "hash",
        userId: "user123",
      };
      const mockQuery = {
        select: vi.fn().mockResolvedValue(mockSessionDoc),
      };
      (AuthSession.findOne as any).mockReturnValue(mockQuery);
      (argon2.verify as any).mockResolvedValue(true);
      (AuthSession.updateOne as any).mockResolvedValue({});

      await authService.logout(
        { deviceId: "d1", refreshToken: "rt" },
        "accessToken",
      );

      expect(redisClient.set).toHaveBeenCalledWith(
        "jti123",
        expect.any(String),
        expect.any(Object),
      );
      expect(AuthSession.updateOne).toHaveBeenCalledWith(
        { _id: "session123" },
        expect.objectContaining({ revokedReason: "MANUAL_LOGOUT" }),
      );
    });
  });

  describe("refresh", () => {
    it("should refresh tokens successfully", async () => {
      const mockSessionDoc = {
        _id: "session123",
        userId: "user123",
        tokenHash: "hash",
        deviceId: "d1",
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla",
      };
      // Mock chain for AuthSession.findOne
      const mockQuery = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(mockSessionDoc),
      };
      (AuthSession.findOne as any).mockReturnValue(mockQuery);
      (argon2.verify as any).mockResolvedValue(true);

      const mockUser = { id: "user123" };
      const mockUserQuery = { session: vi.fn().mockResolvedValue(mockUser) };
      (User.findById as any).mockReturnValue(mockUserQuery);

      (AuthSession.deleteOne as any).mockReturnThis();
      (AuthSession.create as any).mockImplementation(() => {});
      (AuthSession.updateOne as any).mockImplementation(() => {});

      (jwtToken.sign as any).mockReturnValue("newAccessToken");
      (argon2.hash as any).mockResolvedValue("newHash");

      // We need access to createSession return value
      // createSession is part of authService, so we are testing it recursively or logic inside it?
      // authService.refresh calls authService.createSession.
      // Since authService is the module under test, calls to `this.createSession` will execute real code (unless we spy on it).
      // We can just rely on the side effects (calls to AuthSession.create).

      const result = await authService.refresh(
        "rt",
        "127.0.0.1",
        "Mozilla",
        "d1",
      );

      expect(result).toHaveProperty("accessToken", "newAccessToken");
      expect(result).toHaveProperty("refreshToken");
      expect(AuthSession.updateOne).toHaveBeenCalledWith(
        { _id: "session123" },
        expect.objectContaining({ revokedReason: "ROTATED" }),
        expect.anything(),
      );
    });
  });
});
