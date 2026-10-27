import { env } from "@shared/validations";
import { z } from "zod";

const singleImageSchema = z.object({
  key: z.string().min(1),
});

export const imageExistenceCheckDtoSchema = z
  .object({
    body: z.object({
      images: z.array(singleImageSchema).min(1).max(env.MAX_PHOTO_FILES),
    }),
    query: z.looseObject({}).optional(),
    params: z.looseObject({}).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.body.images.map(i => i.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: "custom",
        path: ["body", "images"],
        message: "Duplicate keys detected",
      });
    }
  });

export type ImageExistenceCheckDto = z.infer<
  typeof imageExistenceCheckDtoSchema
>["body"];
