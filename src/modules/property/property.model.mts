import { model, Schema } from "mongoose";

import { CurrencyType } from "./types/currencyType.type.mjs";
import type { IProperty } from "./types/property.types.mjs";
import { PropertyCatagory } from "./types/propertyCatagory.type.mjs";

const PropertySchema = new Schema<IProperty>(
  {
    listedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: { type: String, default: "" },

    price: { type: Number, required: true },
    currency: {
      type: String,
      enum: Object.values(CurrencyType),
      default: CurrencyType.KYAT,
    },
    propertyType: {
      type: String,
      required: true,
    },

    locationReadable: { type: String, required: true },
    locationCoordinates: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    city: { type: String, default: "" },
    country: { type: String, default: "" },

    bedrooms: { type: Number },
    bathrooms: { type: Number },
    numOfFloors: { type: Number },
    areaSqFt: { type: Number },

    category: {
      type: String,
      enum: Object.values(PropertyCatagory),
      default: PropertyCatagory.HOUSE,
    },

    photos: { type: [String] },
    amenities: { type: [String] },

    builtYear: { type: Number },
    furnished: { type: Number },

    isAvailable: { type: Boolean, required: true },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      transform(_doc, ret) {
        return ret;
      },
    },
  },
);

PropertySchema.index({ locationCoordinates: "2dsphere" });
PropertySchema.index({
  title: "text",
  locationReadable: "text",
});

export const Property = model<IProperty>("Property", PropertySchema);
