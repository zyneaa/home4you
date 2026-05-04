import { z } from "zod";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const verifyOtpDtoSchema = z.object({
  body: z.object({
    otp: z
      .string()
      .length(6, "OTP must be exactly 6 characters long.")
      .regex(
        /^[a-zA-Z0-9]{6}$/,
        "OTP must consist only of letters and numbers.",
      ),
    email: z.email(),
    deviceId: z
      .string()
      .min(1, "Device ID is required.")
      .regex(uuidRegex, "Device ID must be a valid UUID v4 format."),
  }),
  query: z.looseObject({}).optional(),
  params: z.looseObject({}).optional(),
});

export type VerifyOtpDto = z.infer<typeof verifyOtpDtoSchema>["body"];
