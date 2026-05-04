import { randomUUID } from "crypto";

import { env } from "@shared/validations";
import { logger, AppError } from "@utils";
import jwt from "jsonwebtoken";

export const jwtToken = {
  sign: (userId: string): string => {
    try {
      const jti = randomUUID();
      return jwt.sign({ userId, jti }, env.JWT_SECRET, {
        expiresIn: "10m",
        subject: userId,
      });
    } catch (err) {
      logger.error("Error signing access token:", err);
      throw new AppError("Failed to issue access token", 500);
    }
  },

  verify: (token: string): string | jwt.JwtPayload => {
    try {
      return jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      logger.error("Error verifying token:", err);

      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError("Token expired", 401);
      }

      throw new AppError("Invalid or malformed token", 401);
    }
  },
};
