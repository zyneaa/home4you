import { z } from "zod";

const listPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  userId: z.string().optional(),
});

export const listPostsDtoSchema = z.object({
  query: listPostsQuerySchema,
});

export type ListPostsDto = z.infer<typeof listPostsQuerySchema>;
