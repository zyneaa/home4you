import { vi } from "vitest";

// Set test environment variables
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-key-min-32-chars-long-123";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars";
process.env.HMAC_SECRET_KEY = "test-hmac-secret-key-min-32-chars-long";
process.env.PORT = "4000";
process.env.DATABASE_URL = "mongodb://localhost:27017/test_db";
process.env.REDIS_URL = "redis://localhost:6379";

// Global Mocks

// Mock Logger to prevent noise in tests
vi.mock("@utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  },
}));

// Mock Redis Client (default mock, can be overridden in specific tests)
vi.mock("@config/redis", () => ({
  redisClient: {
    connect: vi.fn(),
    on: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
    isOpen: true,
    options: {},
  },
  initRedis: vi.fn(),
}));

// Mock Mongoose connect/disconnect to avoid real DB connections in unit tests
// Note: Integration tests involving mongodb-memory-server should handle their own connection
vi.mock("@config/db", () => ({
  connectDB: vi.fn(),
}));

// Mock Nodemailer
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-email-id" }),
    }),
  },
}));
