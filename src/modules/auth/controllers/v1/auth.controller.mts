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

function cleanIp(ip: string): string {
  if (ip.startsWith("::ffff:")) {
    return ip.replace("::ffff:", "");
  }
  return ip;
}

export const authController = {
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

  async verifyOtpSignUp(
    req: Request<unknown, unknown, VerifyOtpDto>,
    res: Response,
    next: NextFunction,
  ) {
    await authController.verifyOtp(req, res, OtpType.SIGNUP, next);
  },

  async verifyOtpLogin(
    req: Request<unknown, unknown, VerifyOtpDto>,
    res: Response,
    next: NextFunction,
  ) {
    await authController.verifyOtp(req, res, OtpType.LOGIN, next);
  },

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

  async check(req: Request, res: Response, _next: NextFunction) {
    res.status(200).json({ user: req.user });
  },
};
