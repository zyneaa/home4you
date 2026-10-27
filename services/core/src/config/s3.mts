import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@shared/validations";

export const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
  },
  maxAttempts: 3,
  // Newer SDK versions add default CRC32 checksum headers when presigning,
  // but uploaders (browser/curl) don't send them -> S3 rejects with
  // "There were headers present in the request which were not signed".
  // Only calculate checksums when the operation explicitly requires it.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
