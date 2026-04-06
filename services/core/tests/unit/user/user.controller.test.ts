import { describe, it, expect, vi } from "vitest";
import { Request, Response, NextFunction } from "express";

import { validateDto } from "../../../src/middlewares/validation.middleware.mts";
import { createUserDtoSchema } from "../../../src/modules/user/dtos/create-user.dto.mts";
import { AppError } from "../../../src/utils/appError.mts";

vi.mock("../../../src/utils/index.mts", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock the user service
vi.mock("../../../src/modules/user/user.service.mts", () => ({
  userService: {
    createUser: vi.fn(),
  },
}));

describe("UserController", () => {
  describe("createUser", () => {
    it("should return a 400 error for an invalid email", async () => {
      const req = {
        body: {
          fullName: "Test User",
          email: "invalid-email",
          password: "Password123@",
        },
      } as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await validateDto(createUserDtoSchema)(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
        }),
      );
    });

    it("should return a 400 error for an invalid password", async () => {
      const req = {
        body: {
          fullName: "Test User",
          email: "test@example.com",
          password: "weak",
        },
      } as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await validateDto(createUserDtoSchema)(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
        }),
      );
    });
  });
});
