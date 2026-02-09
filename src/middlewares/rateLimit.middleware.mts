import { redisClient } from "@config";
import { env } from "@shared/validations";
import { logger, AppError } from "@utils";
import type { NextFunction, RequestHandler } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

const LUA_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local currentSubWindow = ARGV[2]
  local validThreshold = tonumber(ARGV[3])
  local windowSize = tonumber(ARGV[4])

  local subWindows = redis.call('HGETALL', key)
  local totalCount = 0
  local fieldsToDelete = {}

  for i = 1, #subWindows, 2 do
      local subWindow = tonumber(subWindows[i])
      local count = tonumber(subWindows[i+1])
      if subWindow <= validThreshold then
          table.insert(fieldsToDelete, subWindows[i])
      else
          totalCount = totalCount + count
      end
  end

  if #fieldsToDelete > 0 then
      redis.call('HDEL', key, unpack(fieldsToDelete))
  end

  if totalCount + 1 > limit then
      return {1, totalCount}
  else
      redis.call('HINCRBY', key, currentSubWindow, 1)
      local ttl = redis.call('TTL', key)
      if ttl < 0 or ttl < windowSize / 2 then
          redis.call('EXPIRE', key, windowSize)
      end
      return {0, totalCount + 1}
  end
`;

let luaSha: string | null = null;
let lastRedisErrorLog = 0;
const REDIS_ERROR_LOG_INTERVAL_MS = 60_000; // throttle logs to once/min

const ensureLuaScript = async (): Promise<string | null> => {
  if (luaSha) {
    return luaSha;
  }

  const client = redisClient;
  try {
    if (typeof client.scriptLoad === "function") {
      luaSha = await client.scriptLoad(LUA_SCRIPT);
      logger.info("The sha: " + luaSha);
      return luaSha;
    }

    if (typeof client.eval === "function") {
      try {
        await client.eval(LUA_SCRIPT, {
          keys: ["__unused__"],
          arguments: ["0"],
        });
      } catch {
        try {
          await client.eval(LUA_SCRIPT);
        } catch {}
      }
    }
  } catch (err) {
    const now = Date.now();
    if (now - lastRedisErrorLog > REDIS_ERROR_LOG_INTERVAL_MS) {
      logger.warn(
        "Failed to SCRIPT LOAD rate-limit LUA script (will fallback to EVAL)",
        {
          message: (err as Error)?.message ?? err,
        },
      );
      lastRedisErrorLog = now;
    }
  }
  return luaSha;
};

async function runLua(key: string, args: string[]): Promise<[number, number]> {
  const client: any = redisClient;

  if (luaSha) {
    try {
      if (typeof client.evalSha === "function") {
        const res = await client.evalSha(luaSha, {
          keys: [key],
          arguments: args,
        });
        return [Number(res[0]), Number(res[1])];
      } else if (typeof client.evalsha === "function") {
        const res = await client.evalsha(luaSha, {
          keys: [key],
          arguments: args,
        });
        return [Number(res[0]), Number(res[1])];
      }
    } catch (err: any) {
      if (
        (err.message && err.message.includes("NOSCRIPT")) ||
        err?.code === "NOSCRIPT"
      ) {
        luaSha = null;
      } else {
        throw err;
      }
    }
  }

  const loadedSha = await ensureLuaScript();

  if (loadedSha) {
    try {
      const res = await (client.evalSha as any)(loadedSha, {
        keys: [key],
        arguments: args,
      });
      return [Number(res[0]), Number(res[1])];
    } catch (err: any) {
      if (
        !(
          (err.message && err.message.includes("NOSCRIPT")) ||
          err?.code === "NOSCRIPT"
        )
      ) {
        throw err;
      }
    }
  }

  if (typeof client.eval === "function") {
    const res = await client.eval(LUA_SCRIPT, {
      keys: [key],
      arguments: args,
    });
    return [Number(res[0]), Number(res[1])];
  }

  throw new Error("Redis client does not support EVAL/EVALSHA on this runtime");
}

// Ratelimiters
const rateLimiter = async (
  key: string,
  windowSize: number,
  subWindowSize: number,
  limit: number,
  next: NextFunction,
): Promise<void> => {
  const now = Date.now();

  if (subWindowSize <= 0 || windowSize <= 0 || limit <= 0) {
    logger.warn("Rate limiter env invalid, skipping rate limit");
    return next();
  }
  const subWindowSizeMs = subWindowSize * 1000;
  const currentSubWindow = Math.floor(now / subWindowSizeMs);
  const validThreshold =
    currentSubWindow - Math.floor(windowSize / subWindowSize);

  try {
    const [status, _] = await runLua(key, [
      limit.toString(),
      currentSubWindow.toString(),
      validThreshold.toString(),
      windowSize.toString(),
    ]);

    const blocked = Number(status) === 1;

    if (blocked) {
      return next(new AppError("Too many requests", 429));
    }

    next();
  } catch (err) {
    const now = Date.now();
    if (now - lastRedisErrorLog > REDIS_ERROR_LOG_INTERVAL_MS) {
      logger.error("Rate limiter Redis error (failing open)", {
        message: (err as Error)?.message ?? err,
      });
      lastRedisErrorLog = now;
    } else {
      logger.debug("Rate limiter Redis error suppressed (throttled)");
    }

    next();
  }
};

const memoryFallback: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

export const globalRateLimit: RequestHandler = async (
  req,
  res,
  next,
): Promise<void | RateLimitRequestHandler> => {
  const key = `rate_limit:${req.ip}`;
  const WINDOW_SIZE = Number(env.GLOBAL_WINDOW_SIZE);
  const SUB_WINDOW_SIZE = Number(env.GLOBAL_SUB_WINDOW_SIZE);
  const LIMIT = Number(env.GLOBAL_LIMIT);

  try {
    await rateLimiter(key, WINDOW_SIZE, SUB_WINDOW_SIZE, LIMIT, err => {
      if (err) {
        throw err;
      }
      next();
    });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 429) {
      next(err);
    }
    logger.error("Redis down, falling back to memory");
    return memoryFallback(req, res, next) as RateLimitRequestHandler;
  }
};

export const authUserRateLimit: RequestHandler = async (
  req,
  res,
  next,
): Promise<void | RateLimitRequestHandler> => {
  if (!req.user) {
    return next(new AppError("User not found", 404));
  }
  const key = `rate_limit:user:${req.user.id}`;
  const WINDOW_SIZE = Number(env.USER_WINDOW_SIZE);
  const SUB_WINDOW_SIZE = Number(env.USER_SUB_WINDOW_SIZE);
  const LIMIT = Number(env.USER_LIMIT);

  try {
    await rateLimiter(key, WINDOW_SIZE, SUB_WINDOW_SIZE, LIMIT, err => {
      if (err) {
        throw err;
      }
      next();
    });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 429) {
      return next(err);
    }
    logger.error("Redis down, falling back to memory");
    return memoryFallback(req, res, next) as RateLimitRequestHandler;
  }
};
