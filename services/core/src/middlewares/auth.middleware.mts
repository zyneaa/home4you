import { redisClient } from "@config";
import { User } from "@modules/user/user.model.mjs";
import { AppError, logger, jwtToken } from "@utils";
import type { Request, Response, NextFunction, RequestHandler } from "express";

export const protect: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next(
      new AppError("No Token found! Not authorized to access this route", 401),
    );
  }

  try {
    const { userId, jti } = jwtToken.verify(token) as {
      userId: string;
      jti: string;
    };
    try {
      const isBlacklisted = await redisClient.get(jti);
      if (isBlacklisted) {
        logger.warn(`Revoked token access attempt with JTI: ${jti}`);
        return next(
          new AppError("Token has been revoked. Please log in again.", 401),
        );
      }
    } catch (e) {
      logger.error(e);
      return next(new AppError("Redis error", 500));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError("User not found", 401));
    }
    if (!user.emailVerified) {
      return next(new AppError("Email is not verified", 401));
    }

    req.user = user;

    next();
  } catch (error) {
    logger.error(error);
    return next(new AppError("Not authorized to access this route", 401));
  }
};
