import argon2 from "argon2";
import { model, Schema } from "mongoose";
import type { InferSchemaType } from "mongoose";

import type { IUser } from "./types/user.type.mjs";

const UserSchema = new Schema<IUser>(
  {
    userName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    emailVerified: { type: Boolean, default: false },

    passwordHash: { type: String, select: false },

    failedLoginAttempts: { type: Number, default: 0, select: false },

    lockUntil: { type: Date, select: false },
    roles: { type: [String], default: ["user"], index: true },
    phone: { type: String, trim: true, sparse: true },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    collection: "users",
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        // remove sensitive/internal fields when serializing
        delete ret.passwordHash;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret._id;
        return ret;
      },
    },
  },
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ userName: 1 }, { unique: true });
UserSchema.index({ roles: 1 });

UserSchema.methods["setPassword"] = async function (
  this: IUser,
  password: string,
): Promise<void> {
  // Argon2 hashing with reasonable defaults, can be tuned
  this.passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
  });
  this.failedLoginAttempts = 0;
  this.lockUntil = null;
};

export type CreatedUser = InferSchemaType<typeof UserSchema>;
export const User = model("User", UserSchema);
