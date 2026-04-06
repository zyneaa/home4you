import { Schema, model } from "mongoose";

import type { IAuthSession } from "./types/authSession.type.mjs";

const AuthSessionSchema = new Schema<IAuthSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      select: false,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

AuthSessionSchema.index({
  userId: 1,
  deviceId: 1,
  revokedAt: 1,
});

export const AuthSession = model<IAuthSession>(
  "AuthSession",
  AuthSessionSchema,
);
