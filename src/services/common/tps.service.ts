import { redis } from "@/infra/redis-instance";
import { TooManyRequests } from "@/utils/error";

export class TpsService {
  private static async consume(
    key: string,
    limit: number,
    windowSeconds: number,
    message: string
  ) {
    if (!limit || limit <= 0) return;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    if (current > limit) {
      const ttl = await redis.ttl(key);
      throw TooManyRequests(`${message}. Retry after ${ttl}s.`);
    }
  }

  static async system(type: "PAYIN" | "PAYOUT" | "STATUS", limit: number, windowSeconds = 1) {
    const key = `tps:system:${type}`;
    await this.consume(key, limit, windowSeconds, "System TPS limit exceeded");
  }

  static async merchant(merchantId: string, type: "PAYIN" | "PAYOUT", limit: number, windowSeconds = 1) {
    const key = `tps:merchant:${merchantId}:${type}`;
    await this.consume(key, limit, windowSeconds, "Merchant TPS limit exceeded");
  }

  static async ple(pleId: string, type: "PAYIN" | "PAYOUT", limit: number, windowSeconds = 1) {
    const key = `tps:ple:${pleId}:${type}`;
    await this.consume(key, limit, windowSeconds, "Provider TPS limit exceeded");
  }
}
