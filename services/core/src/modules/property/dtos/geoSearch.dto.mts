import { z } from "zod";

const geoSearchSchema = z.object({
  longitude: z.coerce.number().min(-180).max(180),
  latitude: z.coerce.number().min(-90).max(90),
  maxDistanceMeters: z.coerce.number().positive().default(5000),
});

export const geoSearchDtoSchema = z.object({
  query: geoSearchSchema,
  body: z.looseObject({}).optional(),
  params: z.looseObject({}).optional(),
});

export type GeoSearchDto = z.infer<typeof geoSearchSchema>;
