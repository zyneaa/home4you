import { randomUUID } from "crypto";

import type { RequestHandler } from "express";

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  res.locals["requestId"] = id;
  next();
};
