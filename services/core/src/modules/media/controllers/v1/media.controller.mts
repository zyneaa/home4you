import type { ImageExistenceCheckDto } from "@modules/media/dtos/imageExistenceCheck.dto.mjs";
import type { ImageUploadCheckDto } from "@modules/media/dtos/imageUploadCheck.dto.mjs";
import { mediaService } from "@modules/media/media.service.mjs";
import { AppError } from "@utils";
import type { Request, Response, NextFunction } from "express";

export const mediaController = {
  async signImageUpload(
    req: Request<unknown, unknown, ImageUploadCheckDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthorized", 401);
      }

      const validatedBody = req.validated!.body as ImageUploadCheckDto;

      const signed = await mediaService.signMultipleImages(
        req.user.id,
        validatedBody,
      );

      res.status(200).json(signed);
    } catch (error) {
      next(error);
    }
  },

  async confirmUpload(
    req: Request<unknown, unknown, ImageExistenceCheckDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthorized", 401);
      }

      const validatedBody = req.validated!.body as ImageExistenceCheckDto;

      const signed = await mediaService.confirmMediaUploads(
        req.user.id,
        validatedBody,
      );

      res.status(200).json(signed);
    } catch (error) {
      next(error);
    }
  },
};
