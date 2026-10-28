import { propertyBaseSchema } from "@shared/dtos";
import { env } from "@shared/validations";
import { z } from "zod";

// Media are referenced by their stable mediaId (returned by the sign
// endpoints), never by client-supplied S3 keys. Idempotency: postId is a
// client-generated uuidv7 protected by the Post unique index, so a retry
// after a timeout returns the original post instead of creating a duplicate.
export const addPostBodySchema = propertyBaseSchema
  .omit({ images: true })
  .extend({
    postId: z.uuidv7(),
    description: z.string().optional(),

    mediaIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(env.MAX_PHOTO_FILES),
  });

export const createPostDtoSchema = z.object({
  body: addPostBodySchema,
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export type CreatePostDto = z.infer<typeof addPostBodySchema>;
