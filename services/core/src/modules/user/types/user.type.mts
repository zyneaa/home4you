import crypto from "crypto";

import type mongoose from "mongoose";

export interface IUser extends mongoose.Document {
  userName: string;
  email: string;
  emailVerified: boolean;
  passwordHash?: string;
  failedLoginAttempts?: number;
  lockUntil?: Date | null;
  roles: string[];
  phone?: string;

  setPassword(password: string): Promise<void>;
  generateOtp(length: number): Promise<string>;
}

export function createTokenHash(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}
