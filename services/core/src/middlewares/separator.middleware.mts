import { logger } from "@utils";
import type { RequestHandler } from "express";

export const logSeparator: RequestHandler = (_req, res, next) => {
  res.on("finish", () => {
    logger.info("----------");
  });
  next();
};
