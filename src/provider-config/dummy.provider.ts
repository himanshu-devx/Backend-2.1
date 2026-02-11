import { BaseProvider } from "./base-provider";
import { logger } from "@/infra/logger-instance";
import { ENV } from "@/config/env";
import type {
  PayinRequest,
  PayoutRequest,
  ProviderPayinResult,
  ProviderPayoutResult,
  ProviderStatusResult,
  ProviderWebhookInput,
  ProviderWebhookResult,
  StatusRequest,
} from "./types";

/**
 * Dummy Payment Provider
 * Simulates real-world provider behavior with random responses and delayed webhooks.
 */
export class DummyProvider extends BaseProvider {
  /**
   * Handle Payin Simulation
   */
  async handlePayin(req: PayinRequest): Promise<ProviderPayinResult> {
    logger.info(`[DummyProvider] Initiating Payin for ${req.transactionId}`);

    if (!req.transactionId || !req.amount || req.amount <= 0) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount || 0,
        new Error("Invalid payin request")
      ) as ProviderPayinResult;
    }

    const uniqueRef = `DUMMY_PY_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;

      // const result=await this.request(
      //   {
      //     method:"POST",
      //     url:"",
      //     data:{},
      //     headers:{},
      //     context:{
      //       orderId:uniqueRef
      //     }
      //   }
      // )
      

    const result: ProviderPayinResult = {
      type: "payin",
      success: true,
      status: "PENDING",
      message: "Payment Initiated (Dummy)",
      transactionId: req.transactionId,
      providerTransactionId: uniqueRef,
      amount: req.amount,
      result: `https://checkout.dummy.com/pay/${req.transactionId}`,
    };

    // Simulate async webhook
    this.dispatchDelayedWebhook({
      type: "PAYIN",
      transactionId: req.transactionId,
      providerTransactionId: result.providerTransactionId!,
      amount: req.amount,
      status: this.resolveOutcome(req.remarks),
      legalEntityId: this.config.legalEntityId || "default",
    });

    return result;
  }

  /**
   * Handle Payout Simulation
   */
  async handlePayout(req: PayoutRequest): Promise<ProviderPayoutResult> {
    logger.info(`[DummyProvider] Initiating Payout for ${req.transactionId}`);

    if (!req.transactionId || !req.amount || req.amount <= 0) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount || 0,
        new Error("Invalid payout request")
      ) as ProviderPayoutResult;
    }

    const uniqueRef = `DUMMY_PO_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    const result: ProviderPayoutResult = {
      type: "payout",
      success: true,
      status: "PENDING",
      message: "Payout Request Accepted",
      transactionId: req.transactionId,
      providerTransactionId: uniqueRef,
      amount: req.amount,
    };

    const outcome = this.resolveOutcome(req.remarks);

    // Simulate async webhook
    this.dispatchDelayedWebhook({
      type: "PAYOUT",
      transactionId: req.transactionId,
      providerTransactionId: result.providerTransactionId!,
      amount: req.amount,
      status: outcome,
      legalEntityId: this.config.legalEntityId || "default",
    });

    return result;
  }

  /**
   * Status Sync Simulation
   */
  async checkPayinStatus(_req: StatusRequest): Promise<ProviderStatusResult> {
    return {
      status: "PENDING",
      message: "Transaction is still being processed in dummy simulation",
    };
  }

  async checkPayoutStatus(_req: StatusRequest): Promise<ProviderStatusResult> {
    return {
      status: "PENDING",
      message: "Transaction is still being processed in dummy simulation",
    };
  }

  /**
   * Webhook Handler (Not used in simulation since we are the ones sending it)
   */
  async handleWebhook(
    input: ProviderWebhookInput,
    _type: "PAYIN" | "PAYOUT" | "COMMON"
  ): Promise<ProviderWebhookResult> {
    let payload: any;
    try {
      payload = JSON.parse(input.rawBody || "{}");
    } catch (err: any) {
      throw new Error(`Invalid webhook payload: ${err.message}`);
    }

    const normalizedStatus = this.normalizeStatus(
      payload.status || payload.status_code || payload.state
    );

    return {
      type: "webhook",
      success: true,
      status: normalizedStatus,
      message: "Webhook parsed",
      transactionId: payload.ref_id || payload.transaction_id || payload.transactionId,
      providerTransactionId: payload.payment_id || payload.provider_transaction_id,
      amount: payload.amount || payload.amount_inr,
      utr: payload.utr || `UTR${Date.now()}`,
    };
  }

  /**
   * Helper to dispatch an async webhook after a delay
   */
  private dispatchDelayedWebhook(data: {
    type: "PAYIN" | "PAYOUT";
    transactionId: string;
    providerTransactionId: string;
    amount: number;
    status: "SUCCESS" | "FAILED" | "PENDING";
    legalEntityId: string;
  }) {
    const delay = 2000;
    const apiUrl = ENV.APP_BASE_URL || "http://localhost:4000";
    const webhookUrl = `${apiUrl}/webhook/${data.type.toLowerCase()}/${
      this.providerId
    }/${data.legalEntityId}`;

    const payload = {
      payment_id: data.providerTransactionId,
      status: data.status,
      amount: data.amount,
      ref_id: data.transactionId,
      transaction_id: data.transactionId,
      utr: `SIM_${Date.now()}`,
      message:
        data.status === "SUCCESS"
          ? "Transaction successful"
          : "Bank rejected transaction",
    };

    setTimeout(async () => {
      try {
        logger.info(`[DummyProvider] Dispatching async webhook to ${webhookUrl}`);
        await this.request({
          method: "POST",
          url: webhookUrl,
          data: payload,
          timeoutMs: 5000,
          context: {
            transactionId: data.transactionId,
            action: "webhook",
          },
        });
        logger.info(`[DummyProvider] Webhook delivered for ${data.transactionId}`);
      } catch (err: any) {
        logger.error(
          `[DummyProvider] Webhook delivery failed for ${data.transactionId}: ${
            err.message
          }`
        );
      }
    }, delay);
  }

  private resolveOutcome(remarks?: string): "SUCCESS" | "FAILED" {
    const text = (remarks || "").toLowerCase();
    if (text.includes("fail") || text.includes("error")) return "FAILED";
    return "SUCCESS";
  }
}
