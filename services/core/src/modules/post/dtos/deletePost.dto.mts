import { z } from "zod";

export const deletePostDtoSchema = z.object({
  params: z.object({
    postId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Post ID"),
  }),
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});

export type DeletePostDto = z.infer<typeof deletePostDtoSchema>["params"];
