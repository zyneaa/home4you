import type {
  UpdateUserDto,
  UpdateUserParams,
} from "@modules/user/dtos/update-user.dto.mjs";
import { userService } from "@modules/user/user.service.mjs";
import type { Request, Response, NextFunction } from "express";

/**
 * Controller for handling user management operations.
 */
export const userController = {
  /**
   * Retrieves all users from the system.
   *
   * Logic flow:
   * 1. Call the user service to fetch all user records.
   * 2. Map the user records to their JSON representations.
   * 3. Return a 200 OK response with the list of users.
   * 4. Catch any errors and pass them to the global error handler.
   */
  async getAllUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const users = await userService.getAllUsers();
      res.status(200).json(users.map(u => u.toJSON()));
    } catch (error) {
      next(error);
    }
  },

  /**
   * Retrieves a specific user by their ID.
   *
   * Logic flow:
   * 1. Extract the user ID from the request parameters.
   * 2. Call the user service to fetch the user record by ID.
   * 3. Return a 200 OK response with the user's JSON representation.
   * 4. Catch any errors and pass them to the global error handler.
   */
  async getUserById(
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const user = await userService.getUserById(req.params.id);
      res.status(200).json(user.toJSON());
    } catch (error) {
      next(error);
    }
  },

  /**
   * Updates an existing user's information.
   *
   * Logic flow:
   * 1. Extract the user ID and updated user data from the request parameters and body.
   * 2. Call the user service to update the user record with the provided ID and data.
   * 3. Return a 200 OK response with the updated user's JSON representation.
   * 4. Catch any errors and pass them to the global error handler.
   */
  async updateUser(
    req: Request<UpdateUserParams, unknown, UpdateUserDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const user = await userService.updateUser(req.params.id, req.body);
      res.status(200).json(user.toJSON());
    } catch (error) {
      next(error);
    }
  },

  /**
   * Deletes a user from the system.
   *
   * Logic flow:
   * 1. Extract the user ID from the request parameters.
   * 2. Call the user service to delete the user record associated with the provided ID.
   * 3. Return a 204 No Content status upon successful deletion.
   * 4. Catch any errors and pass them to the global error handler.
   */
  async deleteUser(
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      await userService.deleteUser(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
};
