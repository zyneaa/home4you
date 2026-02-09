import crypto from "crypto";

import { redisClient } from "@config";
import { otpCodeService } from "@modules/otp-code/otpCode.service.mjs";
import { Channel } from "@modules/otp-code/types/channel.type.mjs";
import { OtpType } from "@modules/otp-code/types/otpType.type.mjs";
import { userService, User } from "@modules/user/index.mjs";
import type { IUser } from "@modules/user/types/user.type.mjs";
import { UserProfile } from "@modules/user-profile/userProfile.model.mjs";
import { env } from "@shared/validations";
import { jwtToken, logger } from "@utils";
import { AppError } from "@utils";
import argon2 from "argon2";
import mongoose, { type ClientSession } from "mongoose";

import { AuthSession } from "./auth.model.mjs";
import type { LoginDto } from "./dtos/login.dto.mjs";
import type { LogoutDto } from "./dtos/logout.dto.mjs";
import type { RegisterDto } from "./dtos/register.dto.mjs";

export const authService = {
  async register(dto: RegisterDto) {
    const session = await mongoose.startSession();
    let otp: string;

    try {
      await session.withTransaction(async () => {
        if (dto.channel === Channel.EMAIL) {
          const newUser = await userService.createUser(dto, session);

          const placeholderName = `User_${crypto.randomInt(100000, 999999)}`;
          await UserProfile.create(
            [
              {
                userId: newUser.id,
                fullName: placeholderName,
              },
            ],
            { session },
          );
          otp = await otpCodeService.generateOtp(6);
          await otpCodeService.createAndSetOtp(
            newUser.id,
            otp,
            OtpType.SIGNUP,
            Channel.EMAIL,
            session,
          );
        } else {
          // impl registration with ph number
        }
      });
      if (dto.channel === Channel.EMAIL) {
        await otpCodeService.sendOtp(dto.email, otp!);
      } else {
        // send otp with ph number
      }

      return "OTP has been sent to your email";
    } catch (e) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw e;
    } finally {
      await session.endSession();
    }
  },

  async login(dto: LoginDto) {
    const session = await mongoose.startSession();
    let otp: string;

    try {
      await session.withTransaction(async () => {
        const user = await User.findOne({ email: dto.email })
          .select("+passwordHash +lockUntil +failedLoginAttempts")
          .session(session);
        if (!user) {
          throw new AppError("Invalid credentials", 401);
        }
        if (user.lockUntil && user.lockUntil > new Date(Date.now())) {
          throw new AppError(`Account locked. Try again after sometime`, 423);
        }

        if (!user.passwordHash) {
          logger.error("Issue with password hash");
          throw new Error("Issue with user's password");
        }

        const isPasswordValid = await argon2.verify(
          user.passwordHash,
          dto.password,
        );

        if (!isPasswordValid) {
          await this.lockAccount(user, session);
          throw new AppError("Invalid credentials", 401);
        }

        otp = await otpCodeService.generateOtp(6);
        await otpCodeService.createAndSetOtp(
          user.id,
          otp,
          OtpType.LOGIN,
          Channel.EMAIL,
          session,
        );
      });

      await otpCodeService.sendOtp(dto.email, otp!);

      return "OTP has been sent to your email";
    } catch (e) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw e;
    } finally {
      await session.endSession();
    }
  },

  async createSession(
    userId: string,
    ipAddress: string | unknown,
    userAgent: string,
    deviceId: string,
    session: ClientSession,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = jwtToken.sign(userId);

    let refreshToken: string;
    try {
      refreshToken = crypto.randomBytes(32).toString("hex");
    } catch (err: any) {
      throw new AppError(err.message, 500);
    }

    const tokenHash = await argon2.hash(refreshToken);

    await AuthSession.deleteOne({
      user: userId,
      deviceId,
    }).session(session);
    await AuthSession.create(
      [
        {
          userId,
          tokenHash,
          userAgent,
          ipAddress,
          deviceId,
          expiresAt: new Date(
            Date.now() + env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      ],
      { session },
    );

    return { accessToken, refreshToken };
  },

  async logout(dto: LogoutDto, accessToken: string) {
    const { jti, exp } = jwtToken.verify(accessToken) as {
      jti: string;
      exp: number;
    };
    const ttlSeconds = Math.floor(exp - Date.now() / 1000);
    if (ttlSeconds > 0) {
      await redisClient.set(jti, "blacklisted_jti", {
        expiration: { type: "EX", value: ttlSeconds },
      });
    }

    const tokenFromDb = await AuthSession.findOne({
      deviceId: dto.deviceId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).select("+tokenHash");

    if (!tokenFromDb) {
      logger.info(
        `Logout attempt failed: Session for device ${dto.deviceId} not found or inactive.`,
      );
      return;
    }

    const isValid = await argon2.verify(
      tokenFromDb.tokenHash,
      dto.refreshToken,
    );

    if (!isValid) {
      logger.warn(
        `Logout failed for user ${tokenFromDb.userId}: Token mismatch for device ${dto.deviceId}.`,
      );
      throw new AppError("Invalid credentials provided for logout.", 401);
    }

    await AuthSession.updateOne(
      { _id: tokenFromDb._id },
      { revokedAt: new Date(), revokedReason: "MANUAL_LOGOUT" },
    );
  },

  async refresh(
    refreshToken: string,
    ipAddress: string,
    userAgent: string,
    deviceId: string,
  ) {
    const session = await mongoose.startSession();
    let newTokens: { accessToken: string; refreshToken: string };

    try {
      await session.withTransaction(async () => {
        const tokenFromDb = await AuthSession.findOne({
          deviceId,
          revokedAt: null,
          expiresAt: { $gt: new Date() }, // Ensure token is active
        })
          .session(session)
          .lean()
          .select("+tokenHash");

        if (!tokenFromDb) {
          throw new AppError("Invalid or expired refresh token", 401);
        }

        const userId = tokenFromDb.userId.toString();

        const isValid = await argon2.verify(
          tokenFromDb.tokenHash,
          refreshToken,
        );
        if (!isValid) {
          await AuthSession.updateMany(
            { user: userId },
            { revokedAt: new Date(), revokedReason: "TOKEN_REUSE_DETECTED" },
            { session },
          );
          await session.commitTransaction();

          logger.error(
            `Token reuse/mismatch detected for user ${userId}. Device: ${deviceId}. All sessions revoked.`,
          );
          throw new AppError("Invalid refresh token (Session Terminated)", 401);
        }

        if (
          tokenFromDb.ipAddress !== ipAddress ||
          tokenFromDb.userAgent !== userAgent
        ) {
          logger.warn(
            `Session detail changed during refresh for user ${userId}. Device: ${deviceId}. New IP: ${ipAddress}`,
          );
          // warn, but allow rotation for mobile apps (users change IP/network frequently).
        }

        await AuthSession.updateOne(
          { _id: tokenFromDb._id },
          { revokedAt: new Date(), revokedReason: "ROTATED" },
          { session },
        );

        const user = await User.findById(userId).session(session);
        if (!user) {
          throw new AppError("User account no longer exists", 401);
        }

        newTokens = await this.createSession(
          user.id,
          ipAddress,
          userAgent,
          tokenFromDb.deviceId,
          session,
        );
      });

      return newTokens!;
    } catch (e) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw e;
    } finally {
      await session.endSession();
    }
  },

  async lockAccount(user: IUser, session: ClientSession) {
    if (user.failedLoginAttempts !== undefined) {
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= env.FAILED_LOGIN_ATTEMPT) {
        user.lockUntil = new Date(Date.now() + env.ACCOUNT_LOCK_DURATION);
        user.failedLoginAttempts = 0;
      }
    }

    await user.save({ validateBeforeSave: false, session });
  },
};
