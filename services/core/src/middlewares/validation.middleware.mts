import { AppError } from "@utils";
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import type { ZodObject } from "zod";

export const validateDto =
  (schema: ZodObject) =>
  async (
    req: Request<any, any, any, any>,
    _res: Response,
    next: NextFunction,
  ) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      req.validated = parsed;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorLog = error.issues.map(e => e.message).join("\n");
        next(new AppError(`Validation failed: ${errorLog}`, 400));
      } else {
        next(new AppError("Internal server error", 500));
      }
    }
  };
