import crypto from "crypto";

import { redisClient } from "@config";
import { env } from "@shared/validations";
import { logger } from "@utils";

const consumeNonce = async (
  key: string,
  ttlSeconds: number,
): Promise<boolean> => {
  const res = await redisClient.set(key, "1", {
    NX: true,
    EX: ttlSeconds,
  });

  return res === "OK";
};

export const verifySignature = async (
  payload: string,
  signature: string,
  timestamp: string,
  nonce: string,
  appId = "mobile",
): Promise<boolean> => {
  const secret = env.HMAC_SECRET_KEY;

  const ts = Number(timestamp);
  const now = Date.now();

  if (Math.abs(now - ts) > 60_000) {
    return false;
  }

  const nonceKey = `nonce:${appId}:${nonce}`;
  const accepted = await consumeNonce(nonceKey, 60);
  if (!accepted) {
    logger.warn("Nonce already in used");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}:${nonce}:${payload}`)
    .digest("hex");

  logger.info(`expected:  ${expected}`);
  logger.info(`signature: ${signature}`);

  if (expected.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
};
