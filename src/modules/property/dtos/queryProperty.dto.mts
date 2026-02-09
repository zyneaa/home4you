import { z } from "zod";

import { PropertyCatagory } from "../types/propertyCatagory.type.mjs";

const queryPropertySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(10),

  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),

  category: z.enum(PropertyCatagory).optional(),

  transactionType: z.string().optional(),

  city: z.string().optional(),
  country: z.string().optional(),

  bedrooms: z.coerce.number().int().min(0).optional(),

  sortBy: z.enum(["price", "createdAt", "areaSqFt"]).default("createdAt"),

  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const queryPropertyDtoSchema = z.object({
  query: queryPropertySchema,
});

export type QueryPropertyDto = z.infer<typeof queryPropertySchema>;
