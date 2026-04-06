import type mongoose from "mongoose";

export interface IUserProfile {
  userId: mongoose.Types.ObjectId;

  fullName: string;
  avatarUrl: string;
  bio: string;
  education: string;

  socials: string[];

  rating: number;
  verified: boolean;

  position: string;

  postCount: number;
  reviewCount: number;
  savedPostCount: number;
  soldOutPropertyCount: number;

  location: {
    township: string;
    city: string;
  };
}
