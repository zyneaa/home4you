import type mongoose from "mongoose";

export interface IOtpCode {
  userId: mongoose.Types.ObjectId;
  authSessionId: mongoose.Types.ObjectId;
  codeHash: string;
  type: string;
  channel: string;
  expiresAt: Date;
  usedAt: Date | null;
  failedAttempts: number;
  userAgent: string | null;
  ip: string;
}
