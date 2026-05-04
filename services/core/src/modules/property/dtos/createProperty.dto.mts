import { propertyBaseSchema } from "@shared/dtos";
import { z } from "zod";

export const createPropertyDtoSchema = z
  .object({
    body: propertyBaseSchema,
    query: z.looseObject({}).optional(),
    params: z.looseObject({}).optional(),
  })
  .strict();

export type CreatePropertyDto = z.infer<typeof createPropertyDtoSchema>;
