import { describe, it, expect, vi, beforeEach } from "vitest";

import { userService } from "../../../src/modules/user/user.service.mjs";
import { User } from "../../../src/modules/user/user.model.mjs";
import { AppError } from "../../../src/utils/appError.mjs";
import mongoose from "mongoose";

// Mock User model
vi.mock("../../../src/modules/user/user.model.mjs", () => ({
  User: {
    findOne: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
  },
}));

describe("User Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createUser", () => {
    // Requires mocking mongoose session and User constructor
    // Since User is a class, testing `new User(...)` requires slightly different mocking or integration style
    // However, since we mock the module, `new User` might fail if not handled.
    // For unit testing services that use `new Model()`, it's often easier to mock the prototype or return a mock instance
  });

  describe("getUserById", () => {
    it("should return user if found", async () => {
      const mockUser = { id: "user123", name: "Test" };
      (User.findById as any).mockResolvedValue(mockUser);

      const result = await userService.getUserById("user123");

      expect(result).toBe(mockUser);
      expect(User.findById).toHaveBeenCalledWith("user123");
    });

    it("should throw 404 if not found", async () => {
      (User.findById as any).mockResolvedValue(null);

      await expect(userService.getUserById("user123")).rejects.toThrow(
        AppError,
      );
    });
  });

  describe("updateUser", () => {
    it("should return updated user", async () => {
      const mockUser = { id: "user123", name: "Updated" };
      (User.findByIdAndUpdate as any).mockResolvedValue(mockUser);

      const result = await userService.updateUser("user123", {
        fullName: "Updated",
      });

      expect(result).toBe(mockUser);
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        "user123",
        { fullName: "Updated" },
        { new: true },
      );
    });

    it("should throw 404 if user to update is not found", async () => {
      (User.findByIdAndUpdate as any).mockResolvedValue(null);

      await expect(userService.updateUser("user123", {})).rejects.toThrow(
        AppError,
      );
    });
  });

  describe("deleteUser", () => {
    it("should delete user successfully", async () => {
      (User.deleteOne as any).mockResolvedValue({ deletedCount: 1 });

      await userService.deleteUser("user123");

      expect(User.deleteOne).toHaveBeenCalledWith({ _id: "user123" });
    });

    it("should throw 404 if user to delete is not found", async () => {
      (User.deleteOne as any).mockResolvedValue({ deletedCount: 0 });

      await expect(userService.deleteUser("user123")).rejects.toThrow(AppError);
    });
  });
});
