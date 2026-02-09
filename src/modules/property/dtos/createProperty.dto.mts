import { propertyBaseSchema } from "src/shared/dtos/property.shared.dto.mjs";
import { z } from "zod";

export const createPropertyDtoSchema = z
  .object({
    body: propertyBaseSchema,
  })
  .strict();

export type CreatePropertyDto = z.infer<typeof createPropertyDtoSchema>;
