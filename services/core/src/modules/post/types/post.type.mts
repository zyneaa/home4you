import type mongoose from "mongoose";

export interface IPost {
  postId: string;

  listedBy: mongoose.Types.ObjectId;

  property: mongoose.Types.ObjectId;

  mediaIds: string[];

  description: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;

  currentComplianceScore: number;
  currentActivityModifier: number;
  boostScore: number;

  qualityScore: number;
  propertySnapshot: object;

  postStatus: string;
}
