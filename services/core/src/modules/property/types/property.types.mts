import type { CurrencyType } from "@shared/types";
import type mongoose from "mongoose";

import type { PropertyCatagory } from "./propertyCatagory.type.mjs";
import type { PropertyType } from "./propertyType.type.mjs";

export interface IProperty {
  listedBy: mongoose.Types.ObjectId;

  title?: string;

  price: number;
  currency?: CurrencyType;
  propertyType: PropertyType;

  locationReadable: string;
  locationCoordinates?: {
    type: "Point";
    coordinates: [number, number];
  };
  city?: string;
  country?: string;

  bedrooms?: number;
  bathrooms?: number;
  numOfFloors?: number;
  areaSqFt?: number;

  category?: PropertyCatagory;

  photos?: string[];
  videos?: string[];

  amenities?: string[];

  builtYear?: number;
  furnished?: boolean;

  isAvailable: boolean;
}
