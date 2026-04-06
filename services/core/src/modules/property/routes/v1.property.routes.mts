import { validateDto } from "@middlewares";
import { Router } from "express";

import { propertyController } from "../controllers/v1/property.controller.mjs";
import { createPropertyDtoSchema } from "../dtos/createProperty.dto.mjs";
import { queryPropertyDtoSchema } from "../dtos/queryProperty.dto.mjs";

const router = Router();

router.post(
  "/new",
  validateDto(createPropertyDtoSchema),
  propertyController.createProperty,
);
router.get("/find/:propertyId", propertyController.getProperty);
router.get(
  "/find",
  validateDto(queryPropertyDtoSchema),
  propertyController.getProperties,
);

export default router;
