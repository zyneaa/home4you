import { protect, validateDto } from "@middlewares";
import { Router } from "express";

import { userController } from "../controllers/v1/user.controller.mjs";
import { updateUserDtoSchema } from "../dtos/update-user.dto.mjs";

const router = Router();

router
  .route("/:id")
  .get(protect, userController.getUserById)
  .patch(protect, validateDto(updateUserDtoSchema), userController.updateUser)
  .delete(protect, userController.deleteUser);

export default router;
