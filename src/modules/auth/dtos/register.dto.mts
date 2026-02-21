import { Channel } from "@modules/otp-code/types/channel.type.mjs";
import { z } from "zod";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const baseSchema = z.object({
  userName: z.string().min(2, "User name must be at least 2 characters"),
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
});

const registerBodySchema = z.discriminatedUnion("channel", [
  baseSchema.extend({
    channel: z.literal(Channel.EMAIL),
    email: z.email(),
  }),
  baseSchema.extend({
    channel: z.literal(Channel.SMS),
    phoneNumber: z.string().min(10),
    countryCode: z.string().startsWith("+"),
  }),
]);

export const registerDtoSchema = z.object({
  body: registerBodySchema,
  query: z.looseObject({}).optional(),
  params: z.looseObject({}).optional(),
});

export type RegisterDto = z.infer<typeof registerBodySchema>;
