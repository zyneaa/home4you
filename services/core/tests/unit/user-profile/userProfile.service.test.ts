import { describe, it, expect, vi, beforeEach } from "vitest";

import { userProfileService } from "../../../src/modules/user-profile/userProfile.service.mjs";
import { UserProfile } from "../../../src/modules/user-profile/userProfile.model.mjs";
import { AppError } from "../../../src/utils/appError.mjs";

vi.mock("../../../src/modules/user-profile/userProfile.model.mjs");

describe("User Profile Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getProfile", () => {
    it("should return profile", async () => {
      const mockProfile = { userId: "u1", bio: "Hi" };
      const mockQuery = { lean: vi.fn().mockResolvedValue(mockProfile) };
      (UserProfile.findOne as any).mockReturnValue(mockQuery);

      const result = await userProfileService.getProfile("u1");
      expect(result).toBe(mockProfile);
    });
  });

  describe("updateProfile", () => {
    it("should update allowed fields", async () => {
      const mockProfile = { userId: "u1", bio: "New Bio" };
      const mockQuery = { lean: vi.fn().mockResolvedValue(mockProfile) };
      (UserProfile.findOneAndUpdate as any).mockReturnValue(mockQuery);

      const result = await userProfileService.updateProfile("u1", {
        bio: "New Bio",
      });

      expect(UserProfile.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: "u1" },
        { $set: expect.objectContaining({ bio: "New Bio" }) },
        expect.anything(),
      );
      expect(result).toBe(mockProfile);
    });

    it("should throw 400 if no fields to update", async () => {
      await expect(userProfileService.updateProfile("u1", {})).rejects.toThrow(
        AppError,
      );
    });
  });
});
