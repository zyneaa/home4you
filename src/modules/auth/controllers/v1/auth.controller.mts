import { authService } from "@modules/auth/auth.service.mjs";
import type { LoginDto } from "@modules/auth/dtos/login.dto.mjs";
import type { LogoutDto } from "@modules/auth/dtos/logout.dto.mjs";
import type { RefreshDto } from "@modules/auth/dtos/refresh.dto.mjs";
import type { RegisterDto } from "@modules/auth/dtos/register.dto.mjs";
import type { SendOtpDto } from "@modules/auth/dtos/sendOtp.dto.mjs";
import type { VerifyOtpDto } from "@modules/auth/dtos/verifyOtp.dto.mjs";
import { otpCodeService } from "@modules/otp-code/otpCode.service.mjs";
import { OtpType } from "@modules/otp-code/types/otpType.type.mjs";
import type { Request, Response, NextFunction } from "express";

/**
 * Normalizes an IP address from various possible formats.
 *
 * @param ip - The raw IP address string, array, or undefined.
 * @returns A normalized string representation of the IP address.
 */
function normalizeIp(ip: string | string[] | undefined): string {
  if (!ip) {
    return "unknown";
  }
  if (Array.isArray(ip)) {
    if (ip[0] === undefined) {
      return "unknown";
    } else {
      return ip[0];
    }
  } else {
    return ip;
  }
}

/**
 * Cleans an IP address by removing the IPv6 prefix if present.
 *
 * @param ip - The IP address string to clean.
 * @returns The cleaned IP address string.
 */
function cleanIp(ip: string): string {
  if (ip.startsWith("::ffff:")) {
    return ip.replace("::ffff:", "");
  }
  return ip;
}

/**
 * Controller handling authentication-related requests.
 */
export const authController = {
  /**
   * Handles user registration.
   *
   * Logic flow:
   * 1. Extracts validated registration data from the request body.
   * 2. Calls authService.register to create the user and send an OTP.
   * 3. Returns a 201 Created status with a success message.
   * 4. Catches and passes any errors to the global error handler.
   */
  async register(
    req: Request<unknown, unknown, RegisterDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const message = await authService.register(
        req.validated!.body as RegisterDto,
      );

      res.status(201).json({
        message,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Handles user login.
   *
   * Logic flow:
   * 1. Extracts validated login credentials from the request body.
   * 2. Calls authService.login to verify credentials and initiate the login process (e.g., sending OTP).
   * 3. Returns a 200 OK status with a success message.
   * 4. Catches and passes any errors to the global error handler.
   */
  async login(
    req: Request<unknown, unknown, LoginDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const message = await authService.login(req.validated!.body as LoginDto);

      res.status(200).json({ message });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Handles user logout.
   *
   * Logic flow:
   * 1. Extracts the access token from the Authorization header.
   * 2. Validates the presence of the access token; returns 401 if missing.
   * 3. Extracts validated logout data (refresh token and device ID) from the request body.
   * 4. Calls authService.logout to invalidate the session and blacklist the access token.
   * 5. Returns a 204 No Content status on success.
   * 4. Catches and passes any errors to the global error handler.
   */
  async logout(
    req: Request<unknown, unknown, LogoutDto>,
    res: Response,
    next: NextFunction,
  ) {
    let accessToken: string | undefined;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      accessToken = req.headers.authorization.split(" ")[1];
    }
    if (!accessToken) {
      res.status(401).json({ message: "Access Token not found" });
      return;
    }

    try {
      await authService.logout(req.validated!.body as LogoutDto, accessToken);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  /**
   * Handles token refreshing.
   *
   * Logic flow:
   * 1. Normalizes the client's IP address and user agent from the request.
   * 2. Extracts validated refresh token and device ID from the request body.
   * 3. Calls authService.refresh to rotate the tokens and create a new session.
   * 4. Returns a 200 OK status with the new access and refresh tokens.
   * 5. Catches and passes any errors to the global error handler.
   */
  async refresh(
    req: Request<unknown, unknown, RefreshDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const rawIp = req.headers["x-forwarded-for"] || req.ip || undefined;
      const ip = cleanIp(normalizeIp(rawIp));
      const userAgent = req.headers["user-agent"] || "unknown";

      const validatedBody = req.validated!.body as RefreshDto;
      const newTokens = await authService.refresh(
        validatedBody.refreshToken,
        ip,
        userAgent,
        validatedBody.deviceId,
      );
      res.status(200).json({
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * General handler for verifying OTP codes.
   *
   * Logic flow:
   * 1. Normalizes the client's IP address and user agent from the request.
   * 2. Extracts validated OTP, email, and device ID from the request body.
   * 3. Calls otpCodeService.verifyOtp with the specified OTP type.
   * 4. Returns a 200 OK status with the new session tokens and user data.
   * 5. Catches and passes any errors to the global error handler.
   *
   * @param req - Express request object.
   * @param res - Express response object.
   * @param type - The type of OTP being verified (e.g., SIGNUP, LOGIN).
   * @param next - Express next function.
   */
  async verifyOtp(
    req: Request<unknown, unknown, VerifyOtpDto>,
    res: Response,
    type: OtpType,
    next: NextFunction,
  ) {
    const rawIp = req.headers["x-forwarded-for"] || req.ip || undefined;
    const ip = cleanIp(normalizeIp(rawIp));
    const userAgent = req.headers["user-agent"] || "unknown";

    try {
      const validatedBody = req.validated!.body as VerifyOtpDto;
      const { refreshToken, accessToken, user } =
        await otpCodeService.verifyOtp(
          validatedBody.email,
          validatedBody.otp,
          type,
          ip,
          userAgent,
          validatedBody.deviceId,
        );
      res.status(200).json({
        accessToken,
        refreshToken,
        user,
      });
    } catch (e) {
      next(e);
    }
  },

  /**
   * Handles OTP verification for user sign-up.
   *
   * Logic flow:
   * 1. Delegates to authController.verifyOtp with OtpType.SIGNUP.
   */
  async verifyOtpSignUp(
    req: Request<unknown, unknown, VerifyOtpDto>,
    res: Response,
    next: NextFunction,
  ) {
    await authController.verifyOtp(req, res, OtpType.SIGNUP, next);
  },

  /**
   * Handles OTP verification for user login.
   *
   * Logic flow:
   * 1. Delegates to authController.verifyOtp with OtpType.LOGIN.
   */
  async verifyOtpLogin(
    req: Request<unknown, unknown, VerifyOtpDto>,
    res: Response,
    next: NextFunction,
  ) {
    await authController.verifyOtp(req, res, OtpType.LOGIN, next);
  },

  /**
   * Handles requests to resend an OTP code.
   *
   * Logic flow:
   * 1. Extracts validated email, type, and channel from the request body.
   * 2. Calls otpCodeService.resendOtp to generate and send a new OTP.
   * 3. Returns a 200 OK status with a success message.
   * 4. Catches and passes any errors to the global error handler.
   */
  async resendOtp(
    req: Request<unknown, unknown, SendOtpDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const validatedBody = req.validated!.body as SendOtpDto;
      await otpCodeService.resendOtp(
        validatedBody.email,
        validatedBody.type,
        validatedBody.channel,
      );
      res.status(200).json({ message: "OTP has been sent" });
    } catch (e) {
      next(e);
    }
  },

  /**
   * Checks the current user's authentication status.
   *
   * Logic flow:
   * 1. Returns a 200 OK status with the user object attached to the request (by auth middleware).
   */
  async check(req: Request, res: Response, _next: NextFunction) {
    res.status(200).json({ user: req.user });
  },
};
