import type { CreatePropertyDto } from "@modules/property/dtos/createProperty.dto.mjs";
import type { QueryPropertyDto } from "@modules/property/dtos/queryProperty.dto.mjs";
import type { UpdatePropertyDto } from "@modules/property/dtos/updateProperty.dto.mjs";
import { propertyService } from "@modules/property/property.service.mjs";
import { AppError } from "@utils";
import type { Request, Response, NextFunction } from "express";

export const propertyController = {
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
