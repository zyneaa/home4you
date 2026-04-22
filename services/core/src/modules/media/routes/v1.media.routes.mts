import { validateDto } from "@middlewares";
import { Router } from "express";

import { mediaController } from "../controllers/v1/media.controller.mjs";
import { imageUploadCheckDtoSchema } from "../dtos/imageUploadCheck.dto.mjs";

const router = Router();

router.post(
  "/sign",
  validateDto(imageUploadCheckDtoSchema),
  mediaController.signImageUpload,
);

export default router;
