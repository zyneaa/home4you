import { z } from "zod";

export const createUserDtoSchema = z.object({
  body: z.object({
    userName: z.string().min(2, "User name must be atleast 2 characters"),
    email: z.email(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
        "Password must include at least one capital letter, one special character, and one number",
      ),
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export type CreateUserDto = z.infer<typeof createUserDtoSchema>["body"];
