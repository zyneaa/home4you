import { z } from "zod";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const refreshDtoSchema = z
  .object({
    body: z.object({
      deviceId: z
        .string()
        .min(1, "Device ID is required.")
        .regex(uuidRegex, "Device ID must be a valid UUID v4 format."),
    }),
    query: z.looseObject({}).optional(),
    params: z.looseObject({}).optional(),
  })
  .strict();

export type RefreshDto = z.infer<typeof refreshDtoSchema>["body"];
