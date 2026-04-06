import { propertyBaseSchema } from "src/shared/dtos/property.shared.dto.mjs";
import { z } from "zod";

const updatePropertyBodySchema = propertyBaseSchema
  .extend({
    propertyId: z.uuid(),
  })
  .partial();

export const updatePropertyDtoSchema = z.object({
  body: { updatePropertyBodySchema },
  query: z.looseObject({}).optional(),
  params: z.looseObject({}).optional(),
});

export type UpdatePropertyDto = z.infer<typeof updatePropertyBodySchema>;
