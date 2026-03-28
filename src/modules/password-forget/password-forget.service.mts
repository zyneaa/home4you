import { OtpCode } from "@modules/otp-code/otpCode.model.mjs";
import { otpCodeService } from "@modules/otp-code/otpCode.service.mjs";
import { Channel } from "@modules/otp-code/types/channel.type.mjs";
import { OtpType } from "@modules/otp-code/types/otpType.type.mjs";
import { User } from "@modules/user/index.mjs";
import { AppError } from "@utils";
import argon2 from "argon2";
import mongoose from "mongoose";

import type { ForgotPasswordDto } from "./dtos/forgot-password.dto.mjs";
import type { ResetPasswordDto } from "./dtos/reset-password.dto.mjs";

/**
 * Service handling password recovery (forgot/reset) logic.
 */
export const passwordForgetService = {
  /**
   * Initiates the password recovery process by sending an OTP to the user's email.
   *
   * @param dto - Data transfer object containing the user's email.
   * @returns A success message indicating that an OTP has been sent.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<string> {
    const session = await mongoose.startSession();
    let otp: string | undefined;

    try {
      await session.withTransaction(async () => {
        const user = await User.findOne({ email: dto.email }).session(session);
        if (!user) {
          // Don't reveal if user exists or not for security
          return;
        }

        // Generate OTP and store it
        otp = await otpCodeService.generateOtp(6);
        await otpCodeService.createAndSetOtp(
          user.id,
          otp,
          OtpType.PASSWORD_RESET,
          Channel.EMAIL,
          session,
        );
      });

      if (otp) {
        await otpCodeService.sendOtp(dto.email, otp);
      }

      return "An OTP has been sent to your email";
    } catch (e) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw e;
    } finally {
      await session.endSession();
    }
  },

  /**
   * Resets the user's password using a verified OTP.
   *
   * @param dto - Data transfer object containing the email, OTP, and new password.
   * @returns A success message indicating that the password has been reset.
   * @throws AppError if the email or OTP is invalid, expired, or the account is locked.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<string> {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const user = await User.findOne({ email: dto.email })
          .select("+passwordHash")
          .session(session);
        if (!user) {
          throw new AppError("Invalid email or OTP", 400);
        }

        if (user.lockUntil && user.lockUntil > new Date(Date.now())) {
          throw new AppError(`Account locked. Try again after sometime`, 423);
        }

        // Find the OTP code for password reset
        const otpCode = await OtpCode.findOne({
          userId: user.id,
          type: OtpType.PASSWORD_RESET,
        })
          .select("+codeHash +expiresAt")
          .session(session);

        if (!otpCode) {
          throw new AppError("Invalid email or OTP", 400);
        }

        if (otpCode.expiresAt < new Date()) {
          await OtpCode.deleteOne({ _id: otpCode._id }, { session });
          throw new AppError("OTP has expired. Please request a new one", 400);
        }

        if (!otpCode.codeHash) {
          await OtpCode.deleteOne({ _id: otpCode._id }, { session });
          throw new AppError("Invalid email or OTP", 400);
        }

        const isOtpValid = await argon2.verify(otpCode.codeHash, dto.otp);

        if (!isOtpValid) {
          throw new AppError("Invalid email or OTP", 400);
        }

        await user.setPassword(dto.newPassword);
        await user.save({ session });

        await OtpCode.deleteOne({ _id: otpCode._id }, { session });
      });

      return "Password has been reset successfully";
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
