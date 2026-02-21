import { z } from "zod";

export const resetPasswordDtoSchema = z.object({
  body: z.object({
    email: z.email(),
    otp: z
      .string()
      .length(6, "OTP must be exactly 6 characters long.")
      .regex(
        /^[a-zA-Z0-9]{6}$/,
        "OTP must consist only of letters and numbers.",
      ),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
        "Password must include at least one capital letter, one special character, and one number",
      ),
  }),
  query: z.looseObject({}).optional(),
  params: z.looseObject({}).optional(),
});

export type ResetPasswordDto = z.infer<typeof resetPasswordDtoSchema>["body"];
