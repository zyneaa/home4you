import { MediaSessionStatus } from "@shared/types";
import { Schema, model } from "mongoose";

import type { IMediaSession } from "./types/media.type.mjs";

const MediaSessionSchema = new Schema<IMediaSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    uploadId: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(MediaSessionStatus),
      required: true,
      default: MediaSessionStatus.OPEN,
      index: true,
    },

    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

MediaSessionSchema.index({ userId: 1, uploadId: 1 }, { unique: true });
MediaSessionSchema.index({ status: 1, createdAt: 1 });

// TTL: hard-delete session records 30 days after expiry (keeps the
// collection bounded; S3 orphan cleanup is handled by the service routine).
MediaSessionSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: { status: "EXPIRED" },
  },
);

export const MediaSession = model<IMediaSession>(
  "MediaSession",
  MediaSessionSchema,
);
