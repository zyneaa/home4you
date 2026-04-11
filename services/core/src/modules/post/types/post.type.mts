import type mongoose from "mongoose";

export interface IPost {
  listedBy: mongoose.Types.ObjectId;

  property: mongoose.Types.ObjectId;

  description: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;

  currentComplianceScore: number;
  currentActivityModifier: number;
  boostScore: number;
}
