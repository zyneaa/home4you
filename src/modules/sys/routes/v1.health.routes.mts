import { Router } from "express";
import mongoose from "mongoose";

import { checkHealth } from "../controllers/v1/health.controller.mjs";

const router = Router();

router.get("/health", checkHealth);

router.get("/time", (_req, res) =>
  res.status(200).json({ serverTime: Date.now() }),
);

router.get("/readyz", (_req, res) => {
  const isReady = mongoose.connection.readyState === 1;
  if (isReady) {
    return res.status(200).json({ status: "READY" });
  }
  return res.status(503).json({ status: "NOT_READY" });
});

export default router;
