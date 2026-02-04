import { createMiddleware } from "hono/factory";
import { redis } from "@/infra/redis-instance";
import { TooManyRequests } from "@/utils/error";

/**
 * Redis-based Rate Limiter Middleware
 * @param limit Max requests per window
 * @param windowSeconds Window duration in seconds
 */
export const rateLimiter = (limit: number, windowSeconds: number) => {
  return createMiddleware(async (c, next) => {
    // 1. Identify Client (IP or User ID)
    const ip =
      c.req.header("x-forwarded-for") ||
      c.req.header("cf-connecting-ip") ||
      "unknown";
    const user = c.get("user");
    const identifier = user ? user.userId : ip;

    // 2. Construct Key
    const key = `rate-limit:${identifier}:${c.req.path}`;

    // 3. Increment Request Count
    const current = await redis.incr(key);

    // 4. Set Expiry on First Request
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }

    // 5. Check Limit
    if (current > limit) {
      // Get TTL for Retry-After header
      const ttl = await redis.ttl(key);
      c.header("Retry-After", ttl.toString());
      throw TooManyRequests("Too many requests. Please try again later.");
    }

    // 6. Set Headers
    c.header("X-RateLimit-Limit", limit.toString());
    c.header("X-RateLimit-Remaining", Math.max(0, limit - current).toString());

    await next();
  });
};
