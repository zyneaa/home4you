import { authUserRateLimit, globalRateLimit, protect } from "@middlewares";
import { v1AuthRoutes } from "@modules/auth/index.mjs";
import { v1passwordForgetRoutes } from "@modules/password-forget/index.mjs";
import { v1PostRoutes } from "@modules/post/index.mjs";
import { v1PropertyRoutes } from "@modules/property/index.mjs";
import { v1SysRoutes } from "@modules/sys/index.mjs";
import { v1UserRoutes } from "@modules/user/index.mjs";
import { v1UserProfileRoutes } from "@modules/user-profile/index.mjs";
import express from "express";
import { requestSigningGuard } from "src/middlewares/signHMAC.middleware.mjs";

export const routerV1 = express.Router();
// public
routerV1.use("/sys", globalRateLimit, v1SysRoutes);
routerV1.use("/auth", globalRateLimit, requestSigningGuard, v1AuthRoutes);
routerV1.use(
  "/password",
  globalRateLimit,
  requestSigningGuard,
  v1passwordForgetRoutes,
);

// protected
routerV1.use(
  "/user",
  requestSigningGuard,
  protect,
  authUserRateLimit,
  v1UserRoutes,
);
routerV1.use(
  "/user-profile",
  requestSigningGuard,
  protect,
  authUserRateLimit,
  v1UserProfileRoutes,
);
routerV1.use(
  "/property",
  requestSigningGuard,
  protect,
  authUserRateLimit,
  v1PropertyRoutes,
);
routerV1.use(
  "/post",
  requestSigningGuard,
  protect,
  authUserRateLimit,
  v1PostRoutes,
);
