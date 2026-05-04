import { AppError } from "@utils";

import type { UpdateUserProfileDto } from "./dtos/updateProfile.dto.mjs";
import { UserProfile } from "./userProfile.model.mjs";

/**
 * Service for managing user profiles.
 */
export const userProfileService = {
  /**
   * Retrieves the profile associated with a specific user ID.
   *
   * @param {string} userId - The unique identifier of the user whose profile is to be retrieved.
   * @returns {Promise<any>} A promise that resolves to the lean user profile object or null if not found.
   */
  async getProfile(userId: string) {
    const profile = UserProfile.findOne({ userId }).lean();
    return profile;
  },

  /**
   * Updates an existing user profile or creates a new one if it doesn't exist.
   *
   * @param {string} userId - The unique identifier of the user.
   * @param {UpdateUserProfileDto} updatedProfile - Data transfer object containing profile updates.
   * @throws {AppError} Throws a 400 Bad Request error if no fields are provided for the update.
   * @returns {Promise<any>} A promise that resolves to the updated or newly created lean user profile object.
   */
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
