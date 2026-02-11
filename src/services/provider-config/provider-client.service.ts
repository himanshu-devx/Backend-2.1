import { logger } from "@/infra/logger-instance";
import { RESILIENCE_DEFAULTS } from "@/constants/resilience.constant";
import { withTimeout } from "@/utils/resilience/timeout.util";
import { retryWithBackoff, isRetryableError } from "@/utils/resilience/retry.util";
import {
  CircuitBreakerRegistry,
  CircuitOpenError,
} from "@/utils/resilience/circuit-breaker.util";
import { CacheService } from "@/services/common/cache.service";
import { ProviderFactory } from "@/provider-config/provider-factory";
import { ENV } from "@/config/env";

type ProviderType = "BANK" | "GATEWAY";

export class ProviderClient {
  static isRetryableError = isRetryableError;
  private static providerTypeCache = new Map<string, ProviderType>();

  private static circuitKey(pleId: string, action: string) {
    return `provider:${pleId}:${action}`;
  }

  static async execute<T>(
    pleId: string,
    action: "payin" | "payout" | "status",
    fn: () => Promise<T>
  ): Promise<T> {
    const breaker = CircuitBreakerRegistry.get(this.circuitKey(pleId, action), {
      failureThreshold: RESILIENCE_DEFAULTS.CIRCUIT_FAILURE_THRESHOLD,
      openMs: RESILIENCE_DEFAULTS.CIRCUIT_OPEN_MS,
    });

    try {
      return await breaker.execute(() =>
        retryWithBackoff(
          () => withTimeout(fn(), RESILIENCE_DEFAULTS.PROVIDER_TIMEOUT_MS),
          {
            retries: RESILIENCE_DEFAULTS.PROVIDER_RETRIES,
            baseDelayMs: RESILIENCE_DEFAULTS.PROVIDER_RETRY_BASE_MS,
            maxDelayMs: RESILIENCE_DEFAULTS.PROVIDER_RETRY_MAX_MS,
            jitter: RESILIENCE_DEFAULTS.PROVIDER_RETRY_JITTER,
          }
        )
      );
    } catch (err: any) {
      if (err instanceof CircuitOpenError) {
        logger.warn(`[ProviderClient] Circuit open for ${pleId}:${action}`);
      }
      throw err;
    }
  }

  static getProvider(pleId: string) {
    return ProviderFactory.getProvider(pleId);
  }

  private static async getProviderType(providerId: string): Promise<ProviderType> {
    const key = providerId.toLowerCase();
    const cached = this.providerTypeCache.get(key);
    if (cached) return cached;

    const type = await CacheService.getProviderType(key);
    this.providerTypeCache.set(key, type);
    return type;
  }

  static async getProviderForRouting(providerId: string, legalEntityId: string) {
    const type = await this.getProviderType(providerId);
    const configKey = type === "BANK" ? providerId : `${providerId}_${legalEntityId}`;
    return ProviderFactory.getProvider(configKey);
  }

  static async buildWebhookUrl(
    type: "PAYIN" | "PAYOUT" | "COMMON",
    providerId: string,
    legalEntityId?: string
  ): Promise<string> {
    const baseUrl = ENV.APP_BASE_URL || "http://localhost:4000";
    const providerType = await this.getProviderType(providerId);
    const typePath = type.toLowerCase();

    if (providerType === "BANK") {
      return `${baseUrl}/webhook/${typePath}/${providerId}`;
    }

    if (!legalEntityId) {
      throw new Error("legalEntityId is required for gateway webhook URL");
    }

    return `${baseUrl}/webhook/${typePath}/${providerId}/${legalEntityId}`;
  }
}
