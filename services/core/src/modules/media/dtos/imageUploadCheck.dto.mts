import { MimeType } from "@shared/types";
import { env } from "@shared/validations";
import { z } from "zod";

const singleImageSchema = z.object({
  fileName: z.string().min(1).max(255),

  mimeType: z.enum(MimeType),

  fileSize: z.number().int().positive().max(env.MAX_PHOTO_SIZE),

  width: z.number().int().positive().max(env.MAX_PHOTO_WIDTH),

  height: z.number().int().positive().max(env.MAX_PHOTO_HEIGHT),

  order: z.number().min(1).max(env.MAX_PHOTO_FILES),

  isCompressed: z.boolean().optional(),
});

export const imageUploadCheckDtoSchema = z
  .object({
    body: z.object({
      uploadId: z.uuidv7(), // Must be UUID v7 for faster DB ops
      images: z.array(singleImageSchema).min(1).max(env.MAX_PHOTO_FILES),
    }),
    query: z.looseObject({}).optional(),
    params: z.looseObject({}).optional(),
  })
  .strict();

export type SingleImageDto = z.infer<typeof singleImageSchema>;

export type ImageUploadCheckDto = z.infer<
  typeof imageUploadCheckDtoSchema
>["body"];
