import { MediaStatus } from "@shared/types";
import { Schema, model } from "mongoose";

import type { IMedia } from "./types/media.type.mjs";

const MediaSchema = new Schema<IMedia>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    uploadId: {
      type: String,
      required: true,
      index: true,
    },

    mediaId: {
      type: String,
      required: true,
      index: true,
    },

    mediaOwnerId: {
      type: Schema.Types.ObjectId,
      index: true,
    },

    mediaOwnerType: {
      type: String,
      enum: ["POST", "PROFILE_PICTURE"],
      required: true,
      index: true,
    },

    mediaType: {
      type: String,
      enum: ["image", "video"],
      required: true,
    },

    mimeType: {
      type: String,
      required: true,
    },

    key: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "UPLOADED", "FAILED"],
      required: true,
      default: MediaStatus.PENDING,
      index: true,
    },

    order: {
      type: Number,
      default: 0,
    },

    size: {
      type: Number,
      required: true,
    },

    width: {
      type: Number,
    },

    height: {
      type: Number,
    },

    duration: {
      type: Number,
    },

    checksum: {
      type: String,
    },

    variants: {
      type: Map,
      of: String,
      default: {},
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

MediaSchema.index({ mediaOwnerId: 1, mediaOwnerType: 1 });
MediaSchema.index({ userId: 1, status: 1 });
MediaSchema.index({ key: 1 }, { unique: true });

export const Media = model<IMedia>("Media", MediaSchema);
