import { z } from "zod";

export const jwtPayloadSchema = z.object({
  sub: z.string().describe("Subject (User ID)"),
  iat: z.number().int().positive().describe("Issued At Timestamp"),
  exp: z.number().int().positive().describe("Expiration Timestamp"),
  jti: z.uuid().describe("JWT ID"),
  aud: z.string().optional().describe("Audience"),
  role: z.enum(["user", "admin", "guest"]).optional().describe("User Role"),
});
