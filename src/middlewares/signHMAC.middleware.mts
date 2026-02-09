import { AppError, logger } from "@utils";
import type { RequestHandler } from "express";
import { verifySignature } from "src/utils/krypto.mjs";

export const requestSigningGuard: RequestHandler = async (req, _res, next) => {
  try {
    const signature = req.headers["x-signature"] as string;
    const timestamp = req.headers["x-timestamp"] as string;
    const nonce = req.headers["x-nonce"] as string;

    logger.info(
      `Req body type: ${typeof req.body}, Is Buffer: ${req.body instanceof Buffer}`,
    );
    logger.info(`Url: ${req.originalUrl}`);
    logger.info(`Hmac info: Sig=${signature}, TS=${timestamp}, Nonce=${nonce}`);

    // For GET requests, payload is the URL/Query; for POST, it's the body
    const payload =
      req.method === "GET" ? req.originalUrl : req.body.toString();

    logger.info(`SERVER PAYLOAD: ${payload}`);

    if (!signature || !timestamp || !nonce) {
      return next(new AppError("Missing headers", 401));
    }

    const isValid = await verifySignature(payload, signature, timestamp, nonce);
    if (!isValid) {
      return next(new AppError("Invalid request", 403));
    }
    logger.info(`Hash match: ${isValid}`);

    if (req.body instanceof Buffer && req.body.length > 0) {
      try {
        const bodyString = req.body.toString("utf8");
        req.body = JSON.parse(bodyString);
      } catch (err) {
        logger.error(err);
        return next(new AppError("Malformed JSON body", 400));
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};
