import { z } from "zod";

export const updateUserDtoSchema = z.object({
  body: z.object({
    fullName: z
      .string()
      .min(2, "Full name must be at least 2 characters")
      .optional(),
    email: z.email(),
  }),
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID format"),
  }),
  query: z.looseObject({}).optional(),
});

export type UpdateUserDto = z.infer<typeof updateUserDtoSchema>["body"];
export type UpdateUserParams = z.infer<typeof updateUserDtoSchema>["params"];
