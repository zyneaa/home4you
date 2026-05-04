import { validateDto } from "@middlewares";
import { protect } from "@middlewares";
import { Router } from "express";

import { authController } from "../controllers/v1/auth.controller.mjs";
import { loginDtoSchema } from "../dtos/login.dto.mjs";
import { logoutDtoSchema } from "../dtos/logout.dto.mjs";
import { refreshDtoSchema } from "../dtos/refresh.dto.mjs";
import { registerDtoSchema } from "../dtos/register.dto.mjs";
import { sendOtpDtoSchema } from "../dtos/sendOtp.dto.mjs";
import { verifyOtpDtoSchema } from "../dtos/verifyOtp.dto.mjs";

const router = Router();

router.post(
  "/register",
  validateDto(registerDtoSchema),
  authController.register,
);
router.post(
  "/verify-login-otp",
  validateDto(verifyOtpDtoSchema),
  authController.verifyOtpLogin,
);
router.post(
  "/verify-signup-otp",
  validateDto(verifyOtpDtoSchema),
  authController.verifyOtpSignUp,
);
router.post(
  "/send-otp",
  validateDto(sendOtpDtoSchema),
  authController.resendOtp,
);
router.get("/check", protect, authController.check);
router.post("/login", validateDto(loginDtoSchema), authController.login);
router.post("/logout", validateDto(logoutDtoSchema), authController.logout);
router.post("/refresh", validateDto(refreshDtoSchema), authController.refresh);

export default router;
