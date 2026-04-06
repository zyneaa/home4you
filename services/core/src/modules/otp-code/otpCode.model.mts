import { Schema, model } from "mongoose";

import type { IOtpCode } from "./types/otpCode.type.mjs";

const OtpCodeSchema = new Schema<IOtpCode>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },

    authSessionId: { type: Schema.Types.ObjectId, ref: "AuthSession" },

    codeHash: { type: String, required: true, select: false },

    type: {
      type: String,
      enum: ["LOGIN", "SIGNUP", "PASSWORD_RESET", "ACC_VERIFY"],
      required: true,
      index: true,
    },

    channel: {
      type: String,
      required: true,
      enum: ["SMS", "EMAIL"],
    },

    expiresAt: { type: Date, index: true, select: false },

    usedAt: { type: Date },
    failedAttempts: { type: Number, default: 0 },

    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

export const OtpCode = model("OtpCode", OtpCodeSchema);
