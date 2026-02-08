import { ProviderFactory } from "@/providers/provider-factory";
import { logger } from "@/infra/logger-instance";
import { RESILIENCE_DEFAULTS } from "@/constants/resilience.constant";
import { withTimeout } from "@/utils/resilience/timeout.util";
import { retryWithBackoff, isRetryableError } from "@/utils/resilience/retry.util";
import {
  CircuitBreakerRegistry,
  CircuitOpenError,
} from "@/utils/resilience/circuit-breaker.util";

export class ProviderClient {
  static isRetryableError = isRetryableError;

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
}
