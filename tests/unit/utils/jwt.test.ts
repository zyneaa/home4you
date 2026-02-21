import { describe, it, expect, vi, beforeEach } from "vitest";

import { jwtToken } from "../../../src/utils/jwt.mjs";
import jwt from "jsonwebtoken";
import { AppError } from "../../../src/utils/appError.mjs";

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn(),
    verify: vi.fn(),
    TokenExpiredError: class extends Error {},
  },
}));

describe("JWT Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sign", () => {
    it("should sign a token with userId", () => {
      const mockToken = "mock.jwt.token";
      (jwt.sign as any).mockReturnValue(mockToken);

      const token = jwtToken.sign("user123");

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user123", jti: expect.any(String) }),
        expect.any(String),
        expect.objectContaining({ expiresIn: "10m", subject: "user123" }),
      );
      expect(token).toBe(mockToken);
    });

    it("should throw AppError if signing fails", () => {
      (jwt.sign as any).mockImplementation(() => {
        throw new Error("Sign error");
      });

      expect(() => jwtToken.sign("user123")).toThrow(AppError);
      expect(() => jwtToken.sign("user123")).toThrow(
        "Failed to issue access token",
      );
    });
  });

  describe("verify", () => {
    it("should verify a valid token", () => {
      const mockPayload = { userId: "user123", jti: "uuid" };
      (jwt.verify as any).mockReturnValue(mockPayload);

      const payload = jwtToken.verify("valid.token");

      expect(jwt.verify).toHaveBeenCalledWith(
        "valid.token",
        expect.any(String),
      );
      expect(payload).toEqual(mockPayload);
    });

    it("should throw AppError (401) if token is expired", () => {
      const TokenExpiredError = (jwt as any).TokenExpiredError;
      (jwt.verify as any).mockImplementation(() => {
        throw new TokenExpiredError("jwt expired");
      });

      expect(() => jwtToken.verify("expired.token")).toThrow(AppError);
      try {
        jwtToken.verify("expired.token");
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe("Token expired");
      }
    });

    it("should throw AppError (401) if token is invalid", () => {
      (jwt.verify as any).mockImplementation(() => {
        throw new Error("invalid signature");
      });

      expect(() => jwtToken.verify("invalid.token")).toThrow(AppError);
      try {
        jwtToken.verify("invalid.token");
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe("Invalid or malformed token");
      }
    });
  });
});
