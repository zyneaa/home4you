import { propertyBaseSchema } from "@shared/dtos";
import { z } from "zod";

export const addPostBodySchema = propertyBaseSchema.extend({
  postId: z.uuidv7(),
  description: z.string().optional(),
});

export const createPostDtoSchema = z.object({
  body: addPostBodySchema,
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export type CreatePostDto = z.infer<typeof addPostBodySchema>;
