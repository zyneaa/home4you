import { describe, it, expect } from "vitest";

import { AppError } from "../../../src/utils/appError.mjs";

describe("AppError Utility", () => {
  it("should create an error with the correct message and status code", () => {
    const error = new AppError("Test error message", 400);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe("Test error message");
    expect(error.statusCode).toBe(400);
    expect(error.isOperational).toBe(true);
  });

  it("should default to 500 status code if not provided", () => {
    const error = new AppError("Internal error");
    expect(error.statusCode).toBe(500);
  });

  it("should handle array of messages by joining them", () => {
    const messages = ["Error 1", "Error 2"];
    const error = new AppError(messages, 400);

    expect(error.message).toBe("Error 1; Error 2");
  });

  it("should capture stack trace", () => {
    const error = new AppError("Stack trace test");
    expect(error.stack).toBeDefined();
  });
});
