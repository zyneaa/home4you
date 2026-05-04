import { AppError } from "@utils";
import type { RequestHandler } from "express";

export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user?.roles.some(r => roles.includes(r))) {
      return next(new AppError("Insufficient permissions", 403));
    }
    next();
  };
