import Redis from "ioredis";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";

const redisUrl = ENV.REDIS_URL || "redis://localhost:6379";

logger.info(
  `Initializing Redis with URL: ${redisUrl.replace(/:[^:@]+@/, ":***@")}`
);

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

redis.on("ready", () => {
  logger.info("Redis ready");
});

redis.on("error", (err) => {
  logger.error(err, "Redis error");
});
