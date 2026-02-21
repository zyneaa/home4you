import { describe, it, expect, vi, beforeEach } from "vitest";

import { verifySignature } from "../../../src/utils/krypto.mjs";
import { redisClient } from "../../../src/config/redis.mjs";
import crypto from "crypto";

// We mock redisClient in setup.ts, but we need to control its behavior here
// So we just use the mocked instance

describe("Krypto Utility - verifySignature", () => {
  const secret = process.env.HMAC_SECRET_KEY || "test-secret";
  const payload = JSON.stringify({ data: "test" });
  const nonce = "test-nonce";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true for a valid signature", async () => {
    const timestamp = Date.now().toString();

    // Create valid signature
    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}:${nonce}:${payload}`)
      .digest("hex");

    // Mock redis successfully setting the nonce (i.e. nonce not used yet)
    (redisClient.set as any).mockResolvedValue("OK");

    const isValid = await verifySignature(payload, signature, timestamp, nonce);

    expect(isValid).toBe(true);
    expect(redisClient.set).toHaveBeenCalledWith(
      expect.stringContaining(nonce),
      "1",
      expect.objectContaining({ NX: true, EX: 60 }),
    );
  });

  it("should return false if timestamp is too old (> 60s)", async () => {
    const timestamp = (Date.now() - 61000).toString(); // 61s ago
    const signature = "any-sig";

    const isValid = await verifySignature(payload, signature, timestamp, nonce);

    expect(isValid).toBe(false);
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it("should return false if nonce is already used", async () => {
    const timestamp = Date.now().toString();
    const signature = "any-sig";

    // Mock redis returning null (nonce already exists)
    (redisClient.set as any).mockResolvedValue(null);

    const isValid = await verifySignature(payload, signature, timestamp, nonce);

    expect(isValid).toBe(false);
  });

  it("should return false if signature mismatch", async () => {
    const timestamp = Date.now().toString();
    const validSignature = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}:${nonce}:${payload}`)
      .digest("hex");

    const invalidSignature = validSignature.replace("a", "b"); // tamper

    (redisClient.set as any).mockResolvedValue("OK");

    const isValid = await verifySignature(
      payload,
      invalidSignature,
      timestamp,
      nonce,
    );

    expect(isValid).toBe(false);
  });

  it("should return false if signature length is invalid", async () => {
    const timestamp = Date.now().toString();
    const signature = "short";

    (redisClient.set as any).mockResolvedValue("OK");

    const isValid = await verifySignature(payload, signature, timestamp, nonce);

    expect(isValid).toBe(false);
  });
});
