import type { Request, Response, NextFunction } from "express";

import type { ForgotPasswordDto } from "../dtos/forgot-password.dto.mjs";
import type { ResetPasswordDto } from "../dtos/reset-password.dto.mjs";
import { passwordForgetService } from "../password-forget.service.mjs";

/**
 * Controller handling password recovery and reset requests.
 */
export const passwordForgetController = {
  /**
   * Initiates the forgot password process.
   *
   * Logic flow:
   * 1. Extracts the user's email from the request body.
   * 2. Calls passwordForgetService.forgotPassword to generate and send a reset OTP.
   * 3. Returns a 200 OK status with a success message (even if the email is not found, for security).
   * 4. Catches and passes any errors to the global error handler.
   */
  async forgotPassword(
    req: Request<unknown, unknown, ForgotPasswordDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const message = await passwordForgetService.forgotPassword(req.body);
      res.status(200).json({ message });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Resets the user's password using an OTP.
   *
   * Logic flow:
   * 1. Extracts the email, OTP, and new password from the request body.
   * 2. Calls passwordForgetService.resetPassword to verify the OTP and update the user's password.
   * 3. Returns a 200 OK status with a success message.
   * 4. Catches and passes any errors to the global error handler.
   */
  async resetPassword(
    req: Request<unknown, unknown, ResetPasswordDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const message = await passwordForgetService.resetPassword(req.body);
      res.status(200).json({ message });
    } catch (error) {
      next(error);
    }
  },
};
