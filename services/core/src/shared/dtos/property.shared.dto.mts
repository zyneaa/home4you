import { PropertyCatagory } from "@modules/property/types/propertyCatagory.type.mjs";
import { PropertyType } from "@modules/property/types/propertyType.type.mjs";
import { CurrencyType } from "@shared/types";
import { z } from "zod";

export const geoPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
});

export const propertyBaseSchema = z.object({
  title: z.string().optional(),

  price: z.number().positive(),

  currency: z.enum(CurrencyType).optional(),

  propertyType: z.enum(PropertyType),

  transactionType: z.string().min(1),

  locationReadable: z.string().min(2),

  locationCoordinates: geoPointSchema,

  city: z.string().optional(),
  country: z.string().optional(),

  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  numOfFloors: z.number().int().min(0).optional(),
  areaSqFt: z.number().positive().optional(),

  category: z.enum(PropertyCatagory).optional(),

  images: z.array(z.string()).optional(),
  amenities: z.array(z.string()).optional(),

  builtYear: z.number().int().optional(),

  furnished: z.number().int().optional(),

  isAvailable: z.boolean(),
});
