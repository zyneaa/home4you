import { propertyBaseSchema } from "src/shared/dtos/property.shared.dto.mjs";
import { z } from "zod";

const updatePropertyBodySchema = propertyBaseSchema.partial();

export const updatePropertyDtoSchema = z.object({
  body: updatePropertyBodySchema,
});

export type UpdatePropertyDto = z.infer<typeof updatePropertyBodySchema>;
