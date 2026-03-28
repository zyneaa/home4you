import crypto from "crypto";

import { redisClient, transporter } from "@config";
import { authService } from "@modules/auth/auth.service.mjs";
import { OtpCode } from "@modules/otp-code/otpCode.model.mjs";
import { User } from "@modules/user/user.model.mjs";
import { env } from "@shared/validations";
import { AppError, logger } from "@utils";
import argon2 from "argon2";
import mongoose, { type ClientSession } from "mongoose";

import type { Channel } from "./types/channel.type.mjs";
import { OtpType } from "./types/otpType.type.mjs";

/**
 * Service for managing One-Time Password (OTP) codes.
 */
export const otpCodeService = {
  /**
   * Generates a random numeric OTP of a specified length.
   * 
   * @param length - The number of digits in the OTP.
   * @returns A string representing the generated OTP.
   * @throws Error if the length is not a positive integer.
   */
  async generateOtp(length: number): Promise<string> {
    if (length <= 0) {
      throw new Error("Length must be a positive integer.");
    }
    const min = 10 ** (length - 1);
    const max = 10 ** length;
    const numericOtp = crypto.randomInt(min, max);

    return numericOtp.toString();
  },

  /**
   * Sends an OTP code to a user's email address.
   * 
   * @param email - The recipient's email address.
   * @param otp - The OTP code to send.
   */
  async sendOtp(email: string, otp: string): Promise<void> {
    await transporter.sendMail({
      from: `"Home For You" <${env.SMTP_USER}>`,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is: ${otp}`,
      html: `<p>Your OTP is: <b>${otp}</b></p>`,
    });
  },

  /**
   * Resends an OTP to a user, implementing rate limiting.
   * 
   * @param email - The recipient's email address.
   * @param type - The type of OTP (e.g., SIGNUP, LOGIN).
   * @param channel - The delivery channel (e.g., EMAIL).
   * @returns A success message.
   * @throws AppError if rate limited or user not found.
   */
  async resendOtp(
    email: string,
    type: OtpType,
    channel: Channel,
  ): Promise<string> {
    const session = await mongoose.startSession();

    try {
      const lockSetResult = await redisClient.set(email, "locked", {
        EX: env.OTP_RESEND_WINDOW_SECONDS,
        NX: true,
      });

      if (lockSetResult === null) {
        throw new AppError(`Too many requests. Try again later.`, 429);
      }

      session.startTransaction();
      const user = await User.findOne({ email }).session(session);
      if (!user) {
        throw new AppError("User not found or database error", 500);
      }
      const otp = await this.generateOtp(6);
      await this.createAndSetOtp(user.id, otp, type, channel, session);
      await this.sendOtp(email, otp);
      await session.commitTransaction();

      return "OTP has been resent.";
    } catch (e) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      logger.error("OTP Request failed:", e);
      throw e instanceof AppError
        ? e
        : new AppError("Could not process OTP request.", 500);
    } finally {
      session.endSession();
    }
  },

  /**
   * Creates a new OTP record in the database, replacing any existing ones of the same type for the user.
   * 
   * @param userId - The ID of the user.
   * @param otp - The raw OTP code.
   * @param type - The type of OTP.
   * @param channel - The delivery channel.
   * @param session - The MongoDB client session for transactional operations.
   * @returns An object containing the raw OTP and its expiration date.
   */
  async createAndSetOtp(
    userId: string,
    otp: string,
    type: OtpType,
    channel: Channel,
    session: ClientSession,
  ): Promise<{ otp: string; expiresAt: Date }> {
    await OtpCode.deleteMany({ userId, type }, { session });

    const expiryOffset = env.OTP_EXPIRY;
    const codeHash = await argon2.hash(otp);
    const expiresAt = new Date(Date.now() + expiryOffset);

    await OtpCode.create(
      [
        {
          userId,
          codeHash,
          expiresAt,
          type,
          channel,
        },
      ],
      { session },
    );

    return {
      otp,
      expiresAt,
    };
  },

  /**
   * Orchestrates the generation, sending, and storage of an OTP.
   * 
   * @param userId - The ID of the user.
   * @param email - The recipient's email address.
   * @param type - The type of OTP.
   * @param channel - The delivery channel.
   * @param session - The MongoDB client session for transactional operations.
   */
  async otpOperation(
    userId: string,
    email: string,
    type: OtpType,
    channel: Channel,
    session: ClientSession,
  ) {
    const otp = await this.generateOtp(6);
    await this.sendOtp(email, otp);
    await this.createAndSetOtp(userId, otp, type, channel, session);
  },

  /**
   * Verifies an OTP code and establishes an authentication session if successful.
   * 
   * @param email - The user's email address.
   * @param otp - The raw OTP code to verify.
   * @param type - The type of OTP.
   * @param ipAddress - The client's IP address.
   * @param userAgent - The client's user agent.
   * @param deviceId - The client's device ID.
   * @returns An object containing session tokens and the user object.
   * @throws AppError if the OTP is invalid, expired, or the account is locked.
   */
  async verifyOtp(
    email: string,
    otp: string,
    type: OtpType,
    ipAddress: string,
    userAgent: string,
    deviceId: string,
  ) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const user = await User.findOne({ email }).session(session);
      if (!user) {
        throw new AppError("Invalid credentials", 404);
      }
      if (user.lockUntil && user.lockUntil > new Date(Date.now())) {
        throw new AppError(`Account locked. Try again after sometime`, 423);
      }

      if (type === OtpType.SIGNUP && user.emailVerified) {
        throw new AppError("Account already verified", 400);
      }
      if (!user.emailVerified) {
        if (type === OtpType.SIGNUP) {
          user.emailVerified = true;
        } else {
          throw new AppError("Account is not verified", 401);
        }
      }

      const otpCode = await OtpCode.findOne({ userId: user.id, type })
        .select("+codeHash +expiresAt")
        .session(session);
      if (!otpCode) {
        throw new AppError("Invalid email", 404);
      }

      if (otpCode.expiresAt < new Date()) {
        await OtpCode.deleteOne({ _id: otpCode._id }, { session });
        throw new AppError("Invalid request", 401);
      }

      if (!otpCode.codeHash || !otpCode.expiresAt) {
        await authService.lockAccount(user, session);
        await session.commitTransaction();

        throw new AppError("Invalid credentials", 401);
      }

      const isOtpValid = await argon2.verify(otpCode.codeHash, otp);
      if (!isOtpValid) {
        await authService.lockAccount(user, session);
        await session.commitTransaction();

        throw new AppError("Invalid credentials", 401);
      }

      user.emailVerified = true;
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save({ session });

      await OtpCode.deleteOne({ _id: otpCode._id }, { session });

      const { accessToken, refreshToken } = await authService.createSession(
        user.id,
        ipAddress,
        userAgent,
        deviceId,
        session,
      );

      await session.commitTransaction();

      return {
        accessToken,
        refreshToken,
        user: user.toJSON(),
      };
    } catch (e) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw e;
    } finally {
      await session.endSession();
    }
  },
};
