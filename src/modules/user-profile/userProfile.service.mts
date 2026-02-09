import { AppError } from "@utils";

import type { UpdateUserProfileDto } from "./dtos/updateProfile.dto.mjs";
import { UserProfile } from "./userProfile.model.mjs";

export const userProfileService = {
  async getProfile(userId: string) {
    const profile = UserProfile.findOne({ userId }).lean();
    return profile;
  },

  async updateProfile(userId: string, updatedProfile: UpdateUserProfileDto) {
    if (!updatedProfile || Object.keys(updatedProfile).length === 0) {
      throw new AppError("No fields to update", 400);
    }

    const updateData: Partial<UpdateUserProfileDto> = {};

    const allowedFields = [
      "fullName",
      "education",
      "bio",
      "avatarUrl",
      "position",
      "socials",
    ];

    allowedFields.forEach(field => {
      if (updatedProfile[field] !== undefined) {
        updateData[field] = updatedProfile[field];
      }
    });

    if (updatedProfile.location) {
      if (updatedProfile.location.township) {
        updateData["location.township"] = updatedProfile.location.township;
      }
      if (updatedProfile.location.city) {
        updateData["location.city"] = updatedProfile.location.city;
      }
    }

    const profile = await UserProfile.findOneAndUpdate(
      { userId },
      { $set: updateData },
      {
        new: true,
        upsert: true,
        runValidators: true, // ensures DTO doesn't bypass Mongoose rules
      },
    ).lean();

    return profile;
  },
};
