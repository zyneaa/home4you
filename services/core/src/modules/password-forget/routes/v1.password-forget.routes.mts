import { validateDto } from "@middlewares";
import { Router } from "express";

import { passwordForgetController } from "../controllers/password-forget.controller.mjs";
import { forgotPasswordDtoSchema } from "../dtos/forgot-password.dto.mjs";
import { resetPasswordDtoSchema } from "../dtos/reset-password.dto.mjs";

const router = Router();

router.post(
  "/forgot-password",
  validateDto(forgotPasswordDtoSchema),
  passwordForgetController.forgotPassword,
);

router.post(
  "/reset-password",
  validateDto(resetPasswordDtoSchema),
  passwordForgetController.resetPassword,
);

export default router;
