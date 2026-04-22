import type { MediaOwnerType, MimeType, MediaStatus } from "@shared/types";
import type mongoose from "mongoose";

export interface IMedia {
  userId: mongoose.Types.ObjectId;
  mediaId: string;
  mediaOwnerId: mongoose.Types.ObjectId;
  mediaOwnerType: MediaOwnerType;
  mediaType: "image" | "video";
  mimeType: MimeType;
  key: string;
  status: MediaStatus;
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
