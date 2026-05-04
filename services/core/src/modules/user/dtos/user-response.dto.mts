import { z } from "zod";

export const userResponseSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.email(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserResponseDto = z.infer<typeof userResponseSchema>;
