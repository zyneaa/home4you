import { Schema, model } from "mongoose";

import type { IUserProfile } from "./types/userProfile.types.mjs";

const UserProfileSchema = new Schema<IUserProfile>(
  {
    userId: { type: Schema.ObjectId, ref: "User", unique: true, index: true },

    fullName: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: "" },
    bio: { type: String, default: "" },
    education: { type: String, default: "" },

    socials: { type: [String] },

    rating: { type: Number, default: 0.0 },
    verified: { type: Boolean, default: false },

    position: { type: String, default: "" },

    postCount: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    savedPostCount: { type: Number, default: 0 },
    soldOutPropertyCount: { type: Number, default: 0 },

    location: {
      township: String,
      city: String,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      virtuals: true,
    },
  },
);

export const UserProfile = model("UserProfile", UserProfileSchema);
