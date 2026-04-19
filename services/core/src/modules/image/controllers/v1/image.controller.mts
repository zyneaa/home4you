import type { ImageUploadCheckDto } from "@modules/image/dtos/imageUploadCheck.dto.mjs";
import { imageService } from "@modules/image/image.service.mjs";
import { AppError } from "@utils";
import type { Request, Response, NextFunction } from "express";

export const imageController = {
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

      const signed = await imageService.signMultipleImages(
        req.user.id,
        validatedBody,
      );

      res.status(200).json(signed);
    } catch (error) {
      next(error);
    }
  },
};
