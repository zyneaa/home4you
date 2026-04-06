import { AppError } from "@utils";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";

import type { CreateUserDto } from "./dtos/create-user.dto.mjs";
import type { UpdateUserDto } from "./dtos/update-user.dto.mjs";
import type { IUser } from "./types/user.type.mjs";
import { User } from "./user.model.mjs";

/**
 * Service for managing user-related operations.
 */
export const userService = {
  /**
   * Creates a new user in the database.
   *
   * @param {CreateUserDto} userData - Data transfer object containing user information.
   * @param {ClientSession} session - The MongoDB client session for transactional operations.
   * @throws {AppError} Throws a 409 Conflict error if the username or email is already taken.
   * @returns {Promise<IUser>} A promise that resolves to the newly created user document.
   */
  async createUser(
    userData: CreateUserDto,
    session: ClientSession,
  ): Promise<IUser> {
    const existingUser = await User.findOne({
      userName: userData.userName,
      email: userData.email,
    }).session(session);

    if (existingUser) {
      if (existingUser?.userName === userData.userName) {
        throw new AppError("User name already taken.", 409);
      }
      throw new AppError("An account with this email already exists.", 409);
    }

    const newUser = new User(
      {
        _id: new mongoose.Types.ObjectId(),
        userName: userData.userName,
        email: userData.email,
      },
      { session },
    );

    await newUser.setPassword(userData.password);

    await newUser.save({ session });

    return newUser;
  },

  /**
   * Retrieves all users from the database.
   *
   * @returns {Promise<IUser[]>} A promise that resolves to an array of all user documents.
   */
  async getAllUsers(): Promise<IUser[]> {
    return User.find();
  },

  /**
   * Retrieves a single user by their unique identifier.
   *
   * @param {string} id - The unique identifier of the user to retrieve.
   * @throws {AppError} Throws a 404 Not Found error if the user is not found.
   * @returns {Promise<IUser>} A promise that resolves to the user document.
   */
  async getUserById(id: string): Promise<IUser> {
    const user = await User.findById(id);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    return user;
  },

  /**
   * Retrieves a single user by their username.
   *
   * @param {string} userName - The username of the user to retrieve.
   * @throws {AppError} Throws a 404 Not Found error if the user is not found.
   * @returns {Promise<IUser>} A promise that resolves to the user document.
   */
  async getUserByUserName(userName: string): Promise<IUser> {
    const user = await User.findOne({ userName });
    if (!user) {
      throw new AppError("User not found", 404);
    }
    return user;
  },

  /**
   * Updates an existing user's details.
   *
   * @param {string} id - The unique identifier of the user to update.
   * @param {UpdateUserDto} userData - Data transfer object containing the update fields.
   * @throws {AppError} Throws a 404 Not Found error if the user is not found.
   * @returns {Promise<IUser>} A promise that resolves to the updated user document.
   */
  async updateUser(id: string, userData: UpdateUserDto): Promise<IUser> {
    const user = await User.findByIdAndUpdate(id, userData, { new: true });
    if (!user) {
      throw new AppError("User not found", 404);
    }
    return user;
  },

  /**
   * Deletes a user record from the database by ID.
   *
   * @param {string} id - The unique identifier of the user to delete.
   * @throws {AppError} Throws a 404 Not Found error if no user was deleted.
   * @returns {Promise<void>} A promise that resolves when the deletion is complete.
   */
  async deleteUser(id: string): Promise<void> {
    const result = await User.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      throw new AppError("User not found", 404);
    }
  },
};
