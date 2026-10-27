import type {
  MediaOwnerType,
  MimeType,
  MediaUploadStatus,
  MediaProcessingStatus,
  MediaSessionStatus,
  MediaModerationStatus,
} from "@shared/types";
import type mongoose from "mongoose";

export interface IMedia {
  userId: mongoose.Types.ObjectId;

  uploadId: string;
  mediaId: string;

  mediaOwnerId: mongoose.Types.ObjectId;
  isClaimed: boolean;
  mediaOwnerType: MediaOwnerType;

  mediaType: "image" | "video";
  mimeType: MimeType;

  key: string;
  uploadStatus: MediaUploadStatus;
  processingStatus: MediaProcessingStatus;
  moderationStatus: MediaModerationStatus;

  order?: number;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  checksum?: string; // set/verified by the media processor (EP-05), not the API
  variants?: {
    thumbnail?: string;
    medium?: string;
  };
  isDeleted?: boolean;
}

export interface IMediaSession {
  userId: mongoose.Types.ObjectId;
  uploadId: string;
  status: MediaSessionStatus;
  expiresAt?: Date;
}
