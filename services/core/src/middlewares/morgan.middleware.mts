import { logger } from "@utils";
import type express from "express";
import morgan from "morgan";

morgan.token("id", (req: express.Request) => req.id || "-");
export const morganMiddleware = morgan(
  ":id :method :url :status :res[content-length] - :response-time ms",
  {
    stream: {
      write: (msg: string) => logger.info(msg.trim()),
    },
    skip: req => req.url === "/api/health",
  },
);
