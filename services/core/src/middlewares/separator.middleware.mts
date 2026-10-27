import type { RequestHandler } from "express";

export const logSeparator: RequestHandler = (_req, res, next) => {
  res.on("finish", () => {
    console.log("----------");
  });
  next();
};
