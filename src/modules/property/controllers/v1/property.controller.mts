import type { CreatePropertyDto } from "@modules/property/dtos/createProperty.dto.mjs";
import type { QueryPropertyDto } from "@modules/property/dtos/queryProperty.dto.mjs";
import type { UpdatePropertyDto } from "@modules/property/dtos/updateProperty.dto.mjs";
import { propertyService } from "@modules/property/property.service.mjs";
import { AppError } from "@utils";
import type { Request, Response, NextFunction } from "express";

export const propertyController = {
  /**
   * Creates a new property listing.
   * Logic flow:
   * 1. Verifies that the user is authenticated.
   * 2. Retrieves validated property data from the request.
   * 3. Calls propertyService to save the new property to the database.
   * 4. Returns the created property with a 201 status.
   */
  async createProperty(
    req: Request<unknown, unknown, CreatePropertyDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthroized", 401);
      }

      const validatedBody = req.validated?.body as CreatePropertyDto;
      const property = await propertyService.createProperty(
        req.user.id,
        validatedBody,
      );

      res.status(201).json(property);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Retrieves a specific property by its ID.
   * Logic flow:
   * 1. Verifies that the user is authenticated.
   * 2. Calls propertyService to fetch the property details by ID.
   * 3. Returns the property details with a 200 status.
   */
  async getProperty(
    req: Request<{ propertyId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthroized", 401);
      }
      const property = await propertyService.getProperty(req.params.propertyId);

      res.status(200).json(property);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Retrieves a list of properties based on query filters.
   * Logic flow:
   * 1. Passes query parameters (filters, pagination) to propertyService.
   * 2. Returns the list of matching properties with a 200 status.
   */
  async getProperties(
    req: Request<unknown, unknown, unknown, QueryPropertyDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const properties = await propertyService.getProperties(req.query);

      res.status(200).json({ properties });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Updates an existing property listing.
   * Logic flow:
   * 1. Verifies that the user is authenticated.
   * 2. Calls propertyService to update the property details, ensuring the user is the owner.
   * 3. Returns the updated property with a 202 status.
   */
  async updateProperty(
    req: Request<unknown, unknown, UpdatePropertyDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthroized", 401);
      }

      const updatedProperty = await propertyService.updateProperty(
        req.user.id,
        req.body,
      );
      res.status(202).json({ updatedProperty });
    } catch (err) {
      next(err);
    }
  },
};
