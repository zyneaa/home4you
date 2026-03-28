import { propertyBaseSchema } from "src/shared/dtos/property.shared.dto.mjs";
import { z } from "zod";

export const updatePostBodySchema = propertyBaseSchema
  .extend({
    description: z.string().optional(),
  })
  .partial();

export const updatePostDtoSchema = z.object({
  body: updatePostBodySchema,
  params: z.object({
    postId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Post ID"),
  }),
  query: z.object({}).optional(),
});

export type UpdatePostDto = z.infer<typeof updatePostBodySchema>;
