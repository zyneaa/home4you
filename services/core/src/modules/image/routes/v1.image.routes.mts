import { validateDto } from "@middlewares";
import { Router } from "express";

import { imageController } from "../controllers/v1/image.controller.mjs";
import { imageUploadCheckDtoSchema } from "../dtos/imageUploadCheck.dto.mjs";

const router = Router();

router.post(
  "/sign",
  validateDto(imageUploadCheckDtoSchema),
  imageController.signImageUpload,
);

export default router;
