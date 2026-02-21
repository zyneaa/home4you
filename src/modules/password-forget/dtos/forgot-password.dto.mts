import { z } from "zod";

export const forgotPasswordDtoSchema = z.object({
  body: z.object({
    email: z.email(),
  }),
  query: z.looseObject({}).optional(),
  params: z.looseObject({}).optional(),
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordDtoSchema>["body"];
