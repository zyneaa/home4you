import { z } from "zod";

export const updateProfileDtoSchema = z.object({
  body: z
    .object({
      fullName: z
        .string()
        .min(2, "Full name must be at least 2 characters")
        .max(50, "Full name is too long")
        .optional(),

      education: z.string().max(100).optional(),

      bio: z.string().max(200, "Bio must be under 500 characters").optional(),

      avatarUrl: z.url("Invalid image URL").optional(),

      position: z.string().optional(),

      socials: z
        .array(z.url("Each social link must be a valid URL"))
        .optional(),

      location: z
        .object({
          township: z.string().optional(),
          city: z.string().optional(),
        })
        .optional(),
    })
    .strict(), // .strict() ensures they can't pass random fields like 'postCount'
});

export type UpdateUserProfileDto = z.infer<
  typeof updateProfileDtoSchema
>["body"];
