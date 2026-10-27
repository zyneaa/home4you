import { MimeType } from "@shared/types";
import { env } from "@shared/validations";
import { z } from "zod";

// ponytail: file/type names stay image-* (covers images + video now);
// renaming the export/route would ripple through controller + routes for no gain.
const singleMediaSchema = z
  .object({
    fileName: z.string().min(1).max(255),

    mimeType: z.enum(MimeType),

    fileSize: z.number().int().positive(),

    width: z.number().int().positive().max(env.MAX_PHOTO_WIDTH).optional(),

    height: z.number().int().positive().max(env.MAX_PHOTO_HEIGHT).optional(),

    duration: z.number().int().positive().optional(),

    order: z.number().min(1).max(env.MAX_PHOTO_FILES),

    isCompressed: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const isVideo = value.mimeType.startsWith("video/");
    const maxSize = isVideo ? env.MAX_VIDEO_SIZE : env.MAX_PHOTO_SIZE;

    if (value.fileSize > maxSize) {
      ctx.addIssue({
        code: "custom",
        path: ["fileSize"],
        message: `File size exceeds limit of ${maxSize} bytes`,
      });
    }

    if (!isVideo && (value.width === undefined || value.height === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["width"],
        message: "width and height are required for images",
      });
    }
  });

export const imageUploadCheckDtoSchema = z
  .object({
    body: z.object({
      uploadId: z.uuidv7(), // Must be UUID v7 for faster DB ops
      images: z.array(singleMediaSchema).min(1).max(env.MAX_PHOTO_FILES),
    }),
    query: z.looseObject({}).optional(),
    params: z.looseObject({}).optional(),
  })
  .strict();

export type SingleImageDto = z.infer<typeof singleMediaSchema>;

export type ImageUploadCheckDto = z.infer<
  typeof imageUploadCheckDtoSchema
>["body"];
