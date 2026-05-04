import { corsOptions } from "@config";
import { globalErrorHandler, requestId, morganMiddleware } from "@middlewares";
import { routerV1 } from "@routes";
import { AppError } from "@utils";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";

const app = express();

app.use(compression());
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
  }),
);
app.use(cors(corsOptions));
// app.use(express.json({ limit: "1mb" })); // Commented out for HMAC hashes
app.use(
  express.raw({
    type: ["application/json", "application/*+json"],
    limit: "1mb",
  }),
);
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.set("trust proxy", 1); // Trust only the first proxy

// Router and middlewares
app.use(requestId, morganMiddleware);
app.use("/api/v1", routerV1);
app.use((req, _res, next) => {
  const err = new AppError(
    `Can't find the endpoint on the server ${req.originalUrl}`,
    404,
    undefined,
    true,
  );
  next(err);
});
app.use(globalErrorHandler);

export default app;
