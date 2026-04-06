import { AppError } from "@utils";
import mongoose from "mongoose";

import type { CreatePropertyDto } from "./dtos/createProperty.dto.mjs";
import type { QueryPropertyDto } from "./dtos/queryProperty.dto.mjs";
import type { UpdatePropertyDto } from "./dtos/updateProperty.dto.mjs";
import { Property } from "./property.model.mjs";

export const propertyService = {
  /**
   * Creates a new property listing in the database.
   *
   * @param listedBy - The ID of the user creating the listing.
   * @param data - The property data from the request.
   * @returns The created property document.
   */
  async createProperty(listedBy: string, data: CreatePropertyDto) {
    const property = await Property.create({
      listedBy,
      ...data,
    });
    return property;
  },

  /**
   * Retrieves a property by its ID with populated user information.
   *
   * @param propertyId - The ID of the property to retrieve.
   * @returns The property document or null if ID is invalid.
   */
  async getProperty(propertyId: string) {
    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return null;
    }

    return await Property.findById(propertyId).populate("listedBy");
  },

  /**
   * Searches and retrieves properties based on various filtering criteria.
   *
   * @param options - Filtering and pagination options (price range, category, location, etc.).
   * @returns Paginated property data and metadata.
   */
  async getProperties(options: QueryPropertyDto) {
    const {
      page = 1,
      limit: rawLimit = 10,
      minPrice,
      maxPrice,
      category,
      transactionType,
      city,
      country,
      bedrooms,
    } = options;
    const limit = Math.min(Math.max(rawLimit, 1), 100);

    const query: any = {};

    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) {
        query.price.$gte = minPrice;
      }
      if (maxPrice !== undefined) {
        query.price.$lte = maxPrice;
      }
    }

    if (category) {
      query.category = category;
    }
    if (transactionType) {
      query.transactionType = transactionType;
    }
    if (city) {
      query.city = city;
    }
    if (country) {
      query.country = country;
    }
    if (bedrooms !== undefined) {
      query.bedrooms = bedrooms;
    }

    const skip = (page - 1) * limit;
    const [properties, total] = await Promise.all([
      Property.find(query)
        .populate("listedBy")
        .skip(skip)
        .sort({ createdAt: -1 })
        .limit(limit),

      Property.countDocuments(query),
    ]);

    return {
      data: properties,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Finds properties within a specified distance from a geographical point.
   *
   * @param longitude - Geographical longitude.
   * @param latitude - Geographical latitude.
   * @param maxDistanceMeters - Maximum search radius in meters (default 5000).
   * @param limit - Maximum number of results to return (default 50).
   * @returns A list of nearby properties with populated owner data.
   */
  async getNearbyProperties(
    longitude: number,
    latitude: number,
    maxDistanceMeters = 5000,
    limit = 50,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    return Property.find({
      locationCoordinates: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          $maxDistance: maxDistanceMeters,
        },
      },
    })
      .populate("listedBy")
      .limit(safeLimit);
  },

  /**
   * Updates an existing property listing, ensuring ownership verification.
   *
   * @param userId - The ID of the user requesting the update.
   * @param updateData - The property data to update, including propertyId.
   * @returns The updated property document.
   * @throws {AppError} If property not found or user not authorized.
   */
  async updateProperty(userId: string, updateData: UpdatePropertyDto) {
    const property = await Property.findById(updateData.propertyId);
    if (!property) {
      throw new AppError("No property found", 404);
    }
    if (property.listedBy.toString() !== userId) {
      throw new AppError("Not authorized to modify this property", 403);
    }
    return Property.findByIdAndUpdate(updateData.propertyId, updateData, {
      new: true,
      runValidators: true,
    });
  },

  /**
   * Deletes a property listing after ownership verification.
   *
   * @param userId - The ID of the user requesting the deletion.
   * @param propertyId - The ID of the property to delete.
   * @returns The deleted property document.
   * @throws {AppError} If property not found or user not authorized.
   */
  async deleteProperty(userId: string, propertyId: string) {
    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      throw new AppError("No property found", 404);
    }
    const property = await Property.findById(propertyId);
    if (!property) {
      throw new AppError("No property found", 404);
    }
    if (property.listedBy.toString() !== userId) {
      throw new AppError("Not authorized to delete this property", 403);
    }

    return Property.findByIdAndDelete(propertyId);
  },
};
