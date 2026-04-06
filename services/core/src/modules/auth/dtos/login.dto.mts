import { z } from "zod";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const loginDtoSchema = z
  .object({
    body: z.object({
      email: z.email(),
      password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .regex(
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
          "Password must include at least one capital letter, one special character, and one number",
        ),
      deviceId: z
        .string()
        .min(1, "Device ID is required.")
        .regex(uuidRegex, "Device ID must be a valid UUID v4 format."),
    }),
    query: z.looseObject({}).optional(),
    params: z.looseObject({}).optional(),
  })
  .strict();

export type LoginDto = z.infer<typeof loginDtoSchema>["body"];
