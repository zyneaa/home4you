import { env } from "@shared/validations";
import { z } from "zod";

const singleImageSchema = z.object({
  key: z.string(),
});

export const imageExistenceCheckDtoSchema = z
  .object({
    body: z.object({
      images: z.array(singleImageSchema).min(1).max(env.MAX_PHOTO_FILES),
    }),
    query: z.looseObject({}).optional(),
    params: z.looseObject({}).optional(),
  })
  .strict();

export type ImageExistenceCheckDto = z.infer<
  typeof imageExistenceCheckDtoSchema
>["body"];
