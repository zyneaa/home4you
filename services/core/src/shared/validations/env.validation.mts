import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";
import { z } from "zod";

import { logger } from "../../utils/logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .default(String(process.env["PORT"] ?? "8000"))
    .transform(Number),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "http", "verbose", "debug", "silly"])
    .default("info"),
  CORS_ORIGINS: z.string().optional(), // comma-separated list

  // DB related
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_REPLICA_SET: z.string().min(1, "Database replica set is required"),
  MONGO_MAX_POOL_SIZE: z.string().regex(/^\d+$/).transform(Number).default(10),
  MONGO_MIN_POOL_SIZE: z.string().regex(/^\d+$/).transform(Number).default(2),

  // Redis related

  // Rate limiting
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  GLOBAL_LIMIT: z.string().regex(/^\d+$/).transform(Number).default(100),
  GLOBAL_WINDOW_SIZE: z.string().regex(/^\d+$/).transform(Number).default(15),
  GLOBAL_SUB_WINDOW_SIZE: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(5),

  USER_LIMIT: z.string().regex(/^\d+$/).transform(Number).default(100),
  USER_WINDOW_SIZE: z.string().regex(/^\d+$/).transform(Number).default(15),
  USER_SUB_WINDOW_SIZE: z.string().regex(/^\d+$/).transform(Number).default(5),

  // JWT
  JWT_SECRET: z.string().min(32, "JWT_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_SECRET is required"),

  // Auth
  FAILED_LOGIN_ATTEMPT: z.string().regex(/^\d+$/).transform(Number).default(10),
  ACCOUNT_LOCK_DURATION: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(300000),
  REFRESH_TOKEN_EXPIRY_DAYS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(30),
  OTP_EXPIRY: z.string().regex(/^\d+$/).transform(Number).default(300_000),
  OTP_RESEND_WINDOW_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(60),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.string().regex(/^\d+$/).default("2525").transform(Number),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),

  HMAC_SECRET_KEY: z.string().min(32, "HMAC secret is required"),

  // AWS S3
  AWS_REGION: z.string().min(1, "AWS_REGION is required"),

  AWS_ACCESS_KEY_ID: z
    .string()
    .min(16, "AWS Access Key ID is too short")
    .trim(),

  AWS_SECRET_ACCESS_KEY: z
    .string()
    .min(32, "AWS Secret Access Key is too short")
    .trim(),

  AWS_S3_BUCKET_NAME: z
    .string()
    .min(3, "Bucket name is too short")
    .max(63, "Bucket name exceeds S3 limits")
    .regex(
      /^[a-z0-9.-]+$/,
      "Bucket name must be lowercase alphanumeric/hyphens",
    ),

  // Multimedia
  MAX_PHOTO_SIZE: z.string().regex(/^\d+$/).transform(Number).default(5242880),

  MAX_PHOTO_WIDTH: z.string().regex(/^\d+$/).transform(Number).default(1920),

  MAX_PHOTO_HEIGHT: z.string().regex(/^\d+$/).transform(Number).default(1080),

  MAX_PHOTO_FILES: z.string().regex(/^\d+$/).transform(Number).default(10),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  logger.error("Invalid environment configuration", {
    issues: parseResult.error.issues.map(i => ({
      path: i.path.join("."),
      message: i.message,
    })),
  });
  process.exit(1);
}
logger.info("Environment configuration validated");

export const env = parseResult.data;
