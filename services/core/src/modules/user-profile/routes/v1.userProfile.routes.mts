import { validateDto } from "@middlewares";
import { Router } from "express";

import { userProfileController } from "../controllers/v1/userProfile.controller.mjs";
import { updateProfileDtoSchema } from "../dtos/updateProfile.dto.mjs";

const router = Router();

router
  .route("/me")
  .get(userProfileController.getProfile)
  .patch(
    validateDto(updateProfileDtoSchema),
    userProfileController.updateProfile,
  );

export default router;
