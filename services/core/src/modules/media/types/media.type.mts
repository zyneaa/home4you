import type { MediaOwnerType, MimeType, MediaUploadStatus, MediaProcessingStatus } from "@shared/types";
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

  order?: number;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  checksum?: "sha256" | "etag"; // optional (integrity)
  variants?: {
    thumbnail?: string;
    medium?: string;
  };
  isDeleted?: boolean;
}
