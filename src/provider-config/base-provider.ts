import type {
  PayinRequest,
  PayoutRequest,
  ProviderConfig,
  ProviderPayinResult,
  ProviderPayoutResult,
  ProviderStatus,
  ProviderStatusResult,
  ProviderWebhookInput,
  ProviderWebhookResult,
  StatusRequest,
} from "./types";
import { providerRequest, type ProviderHttpRequest } from "./provider-http";

/**
 * Base Provider Class
 * All payment gateway providers must extend this class
 */
export abstract class BaseProvider {
  protected readonly config: ProviderConfig;
  readonly providerId: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.providerId = config.providerId;
  }

  abstract handlePayin(req: PayinRequest): Promise<ProviderPayinResult>;
  abstract handlePayout(req: PayoutRequest): Promise<ProviderPayoutResult>;
  abstract checkPayinStatus(req: StatusRequest): Promise<ProviderStatusResult>;
  abstract checkPayoutStatus(req: StatusRequest): Promise<ProviderStatusResult>;
  
  abstract handleWebhook(
    input: ProviderWebhookInput,
    type: "PAYIN" | "PAYOUT" | "COMMON"
  ): Promise<ProviderWebhookResult>;

  /**
   * Normalize provider status to our standard statuses
   * @param status - Provider-specific status
   * @returns Normalized status
   */
  protected normalizeStatus(status?: string): ProviderStatus {
    const s = (status || "").toUpperCase();
    if (
      ["SUCCESS", "PROCESSED", "COMPLETED", "CAPTURED", "PAID", "SETTLED"].includes(
        s
      )
    ) {
      return "SUCCESS";
    }
    if (["EXPIRED", "TIMEOUT", "CANCELLED"].includes(s)) {
      return "EXPIRED";
    }
    if (["FAILED", "FAILURE", "REJECTED", "DECLINED", "ERROR"].includes(s)) {
      return "FAILED";
    }
    return "PENDING";
  }

  /**
   * Format error response
   */
  protected formatErrorResponse(
    type: "payin" | "payout",
    transactionId: string,
    amount: number,
    error: any
  ): ProviderPayinResult | ProviderPayoutResult {
    return {
      type,
      success: false,
      status: "FAILED",
      message: error?.message || "Provider request failed",
      providerMsg: error?.response?.data?.message || error?.message,
      transactionId,
      amount,
      error: error?.response?.data || error,
    } as ProviderPayinResult | ProviderPayoutResult;
  }

  protected request<T = any>(req: ProviderHttpRequest) {
    return providerRequest<T>({
      ...req,
      context: {
        providerId: this.providerId,
        ...req.context,
      },
    });
  }
}
