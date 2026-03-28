import type { UpdateUserProfileDto } from "@modules/user-profile/dtos/updateProfile.dto.mjs";
import { userProfileService } from "@modules/user-profile/userProfile.service.mjs";
import { AppError } from "@utils";
import type { Request, Response, NextFunction } from "express";

/**
 * Controller for handling user profile-related operations.
 */
export const userProfileController = {
  /**
   * Retrieves the profile of the currently authenticated user.
   *
   * Logic flow:
   * 1. Extract the authenticated user from the request object.
   * 2. If the user is not authenticated, throw a 401 Unauthorized error.
   * 3. Fetch the user's profile from the profile service using the user's ID.
   * 4. Return a 200 OK response with a merged object containing user and profile data,
   *    while excluding internal fields like userId, __v, and _id.
   * 5. Catch any errors and pass them to the global error handler.
   */
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user;
      if (!user) {
        throw new AppError("Not authenticated", 401);
      }

      const profile = await userProfileService.getProfile(user.id);
      res.status(200).json({
        ...user.toObject(),
        ...profile,
        userId: undefined,
        __v: undefined,
        _id: undefined,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Updates the profile of the currently authenticated user.
   *
   * Logic flow:
   * 1. Extract the authenticated user from the request object.
   * 2. If the user is not found, throw a 404 Not Found error.
   * 3. Call the profile service to update the user's profile with the data provided in the request body.
   * 4. Return a 200 OK response with a success message.
   * 5. Catch any errors and pass them to the global error handler.
   */
  async updateProfile(
    req: Request<unknown, unknown, UpdateUserProfileDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const user = req.user;
      if (!user) {
        throw new AppError("User not found", 404);
      }
      const message = await userProfileService.updateProfile(user.id, req.body);

      res.status(200).json({
        message,
      });
    } catch (error) {
      next(error);
    }
  },
};
