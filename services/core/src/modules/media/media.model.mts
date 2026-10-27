import {
  MediaModerationStatus,
  MediaProcessingStatus,
  MediaUploadStatus,
} from "@shared/types";
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

    isClaimed: {
      type: Boolean,
      required: true,
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

    uploadStatus: {
      type: String,
      enum: ["PENDING", "UPLOADED", "FAILED", "CLEANING"],
      required: true,
      default: MediaUploadStatus.PENDING,
      index: true,
    },

    processingStatus: {
      type: String,
      enum: ["PENDING", "PROCESSING", "DONE", "FAILED"],
      required: true,
      default: MediaProcessingStatus.PENDING,
    },

    // Set asynchronously by the classification worker. Listing visibility
    // does not depend on it: labels arrive after synchronous validation.
    moderationStatus: {
      type: String,
      enum: Object.values(MediaModerationStatus),
      required: true,
      default: MediaModerationStatus.PENDING,
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

MediaSchema.index({
  mediaOwnerId: 1,
  mediaOwnerType: 1,
  isDeleted: 1,
  order: 1,
});
MediaSchema.index({ userId: 1, uploadStatus: 1 });
MediaSchema.index({ uploadStatus: 1, isClaimed: 1 });
MediaSchema.index({ uploadStatus: 1, createdAt: 1 });

export const Media = model<IMedia>("Media", MediaSchema);
