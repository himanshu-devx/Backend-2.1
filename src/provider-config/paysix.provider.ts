import { createHmac } from "crypto";
import { BaseProvider } from "./base-provider";
import { logger } from "@/infra/logger-instance";
import type {
  PayinRequest,
  PayoutRequest,
  ProviderPayinResult,
  ProviderPayoutResult,
  ProviderStatus,
  ProviderStatusResult,
  ProviderWebhookInput,
  ProviderWebhookResult,
  StatusRequest,
} from "./types";

type PaysixError = {
  code?: string;
  message?: string;
  description?: string;
  retryable?: boolean;
};

type PaysixInitiateResponse = {
  success?: boolean;
  message?: string;
  data?: {
    orderId?: string;
    transactionId?: string;
    paymentUrl?: string;
    amount?: number | string;
    status?: string;
    utr?: string | null;
  };
  error?: PaysixError;
};

type PaysixStatusResponse = {
  success?: boolean;
  message?: string;
  data?: {
    orderId?: string;
    transactionId?: string;
    amount?: number | string;
    status?: string;
    utr?: string | null;
    type?: string;
  };
  error?: PaysixError;
};

type PaysixWebhookPayload = Record<string, any>;

const DEFAULT_BASE_URL = "https://payment.paysixfintech.net";

const buildUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const toNumber = (value?: number | string | null): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const mapPaysixStatus = (status?: string): ProviderStatus => {
  const normalized = (status || "").toUpperCase();
  if (["SUCCESS"].includes(normalized)) return "SUCCESS";
  if (["FAILED", "REVERSED"].includes(normalized)) return "FAILED";
  if (["EXPIRED"].includes(normalized)) return "EXPIRED";
  if (["PENDING", "PROCESSING"].includes(normalized)) return "PENDING";
  return "PENDING";
};

const parseJsonBody = (rawBody: string): PaysixWebhookPayload => {
  if (!rawBody) return {};
  const trimmed = rawBody.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to form parser
    }
  }
  const params = new URLSearchParams(trimmed);
  const payload: PaysixWebhookPayload = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
};

const resolveErrorMessage = (resp?: PaysixInitiateResponse | PaysixStatusResponse) => {
  if (!resp) return undefined;
  return (
    resp.error?.message ||
    resp.error?.description ||
    resp.message
  );
};

export class PaysixProvider extends BaseProvider {
  private buildHeaders(rawBody: string, apiSecret: string, merchantId: string) {
    const timestamp = Date.now().toString();
    const signature = createHmac("sha256", apiSecret)
      .update(`${rawBody}|${timestamp}`)
      .digest("hex");

    return {
      timestamp,
      headers: {
        "Content-Type": "application/json",
        "x-merchant-id": merchantId,
        "x-timestamp": timestamp,
        "x-signature": signature,
      },
    };
  }

  async handlePayin(req: PayinRequest): Promise<ProviderPayinResult> {
    const creds = this.config.credentials || {};
    const merchantId = creds.merchantId;
    const apiSecret = creds.apiSecret;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!merchantId || !apiSecret) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("PAYSIX credentials missing: merchantId/apiSecret")
      ) as ProviderPayinResult;
    }

    if (!req.customerName || !req.customerEmail || !req.customerPhone) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("PAYSIX payin missing customer details")
      ) as ProviderPayinResult;
    }

    if (!req.paymentMode) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("PAYSIX payin missing payment mode")
      ) as ProviderPayinResult;
    }

    const orderId = (req.orderId || req.transactionId || "").trim();
    if (!orderId) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("PAYSIX payin missing orderId")
      ) as ProviderPayinResult;
    }

    const payload: Record<string, any> = {
      amount: req.amount,
      orderId,
      paymentMode: req.paymentMode,
      customerName: req.customerName,
      customerEmail: req.customerEmail,
      customerPhone: req.customerPhone,
    };

    if (req.remarks) payload.remarks = req.remarks;
    if (req.redirectUrl || req.returnUrl) {
      payload.redirectUrl = req.redirectUrl || req.returnUrl;
    }

    const rawBody = JSON.stringify(payload);
    const { headers } = this.buildHeaders(rawBody, apiSecret, merchantId);

    try {
      const response = await this.request<PaysixInitiateResponse>({
        method: "POST",
        url: buildUrl(baseUrl, "/api/payment/payin/initiate"),
        data: rawBody,
        headers,
        context: {
          action: "payin_create",
          transactionId: req.transactionId,
          orderId,
        },
      });

      const resp = response.data || {};
      if (resp.success === false || resp.error) {
        const message = resolveErrorMessage(resp) || "PAYSIX payin failed";
        return {
          type: "payin",
          success: false,
          status: "FAILED",
          message,
          providerMsg: message,
          transactionId: req.transactionId,
          providerTransactionId: orderId,
          amount: req.amount,
          error: resp,
        };
      }

      const data = resp.data || {};
      const status = mapPaysixStatus(data.status);
      const paymentUrl = data.paymentUrl;

      if (!paymentUrl) {
        return {
          type: "payin",
          success: false,
          status: "FAILED",
          message: "PAYSIX payin missing paymentUrl",
          providerMsg: resolveErrorMessage(resp) || data.status,
          transactionId: req.transactionId,
          providerTransactionId: data.orderId || orderId,
          amount: toNumber(data.amount) ?? req.amount,
          error: resp,
        };
      }

      if (status === "FAILED" || status === "EXPIRED") {
        return {
          type: "payin",
          success: false,
          status,
          message: resolveErrorMessage(resp) || "PAYSIX payin failed",
          providerMsg: data.status,
          transactionId: req.transactionId,
          providerTransactionId: data.orderId || orderId,
          amount: toNumber(data.amount) ?? req.amount,
          error: resp,
        };
      }

      return {
        type: "payin",
        success: true,
        status,
        message: resp.message || "Payin initiated",
        providerMsg: data.status || resp.message,
        transactionId: req.transactionId,
        providerTransactionId: data.orderId || orderId,
        amount: toNumber(data.amount) ?? req.amount,
        result: paymentUrl,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          orderId,
          error: error?.message,
        },
        "[PAYSIX] Payin failed"
      );
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        error
      ) as ProviderPayinResult;
    }
  }

  async handlePayout(req: PayoutRequest): Promise<ProviderPayoutResult> {
    const creds = this.config.credentials || {};
    const merchantId = creds.merchantId;
    const apiSecret = creds.apiSecret;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!merchantId || !apiSecret) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("PAYSIX credentials missing: merchantId/apiSecret")
      ) as ProviderPayoutResult;
    }

    if (
      !req.beneficiaryName ||
      !req.beneficiaryAccountNumber ||
      !req.beneficiaryBankIfsc ||
      !req.beneficiaryBankName
    ) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("PAYSIX payout missing beneficiary details")
      ) as ProviderPayoutResult;
    }

    if (!req.mode) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("PAYSIX payout missing payment mode")
      ) as ProviderPayoutResult;
    }

    const orderId = (req.orderId || req.transactionId || "").trim();
    if (!orderId) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("PAYSIX payout missing orderId")
      ) as ProviderPayoutResult;
    }

    const payload: Record<string, any> = {
      amount: req.amount,
      orderId,
      paymentMode: req.mode,
      beneficiaryName: req.beneficiaryName,
      beneficiaryAccountNumber: req.beneficiaryAccountNumber,
      beneficiaryIfsc: req.beneficiaryBankIfsc,
      beneficiaryBankName: req.beneficiaryBankName,
    };

    if (req.beneficiaryPhone) payload.beneficiaryPhone = req.beneficiaryPhone;
    if (req.remarks) payload.remarks = req.remarks;

    const rawBody = JSON.stringify(payload);
    const { headers } = this.buildHeaders(rawBody, apiSecret, merchantId);

    try {
      const response = await this.request<PaysixInitiateResponse>({
        method: "POST",
        url: buildUrl(baseUrl, "/api/payment/payout/initiate"),
        data: rawBody,
        headers,
        context: {
          action: "payout_create",
          transactionId: req.transactionId,
          orderId,
        },
      });

      const resp = response.data || {};
      if (resp.success === false || resp.error) {
        const message = resolveErrorMessage(resp) || "PAYSIX payout failed";
        return {
          type: "payout",
          success: false,
          status: "FAILED",
          message,
          providerMsg: message,
          transactionId: req.transactionId,
          providerTransactionId: orderId,
          amount: req.amount,
          error: resp,
        };
      }

      const data = resp.data || {};
      const status = mapPaysixStatus(data.status);

      if (status === "FAILED" || status === "EXPIRED") {
        return {
          type: "payout",
          success: false,
          status,
          message: resolveErrorMessage(resp) || "PAYSIX payout failed",
          providerMsg: data.status,
          transactionId: req.transactionId,
          providerTransactionId: data.orderId || orderId,
          amount: toNumber(data.amount) ?? req.amount,
          utr: data.utr || undefined,
          error: resp,
        };
      }

      return {
        type: "payout",
        success: true,
        status,
        message: resp.message || "Payout initiated",
        providerMsg: data.status || resp.message,
        transactionId: req.transactionId,
        providerTransactionId: data.orderId || orderId,
        amount: toNumber(data.amount) ?? req.amount,
        utr: data.utr || undefined,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          orderId,
          error: error?.message,
        },
        "[PAYSIX] Payout failed"
      );
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        error
      ) as ProviderPayoutResult;
    }
  }

  async checkPayinStatus(req: StatusRequest): Promise<ProviderStatusResult> {
    const creds = this.config.credentials || {};
    const merchantId = creds.merchantId;
    const apiSecret = creds.apiSecret;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!merchantId || !apiSecret) {
      return {
        status: "PENDING",
        message: "PAYSIX credentials missing: merchantId/apiSecret",
      };
    }

    const orderId = (req.providerTransactionId || "").trim();
    if (!orderId) {
      return {
        status: "PENDING",
        message: "PAYSIX status check missing orderId",
      };
    }

    const rawBody = "";
    const { headers } = this.buildHeaders(rawBody, apiSecret, merchantId);

    try {
      const response = await this.request<PaysixStatusResponse>({
        method: "GET",
        url: buildUrl(
          baseUrl,
          `/api/payment/payin/status/${encodeURIComponent(orderId)}`
        ),
        headers,
        context: {
          action: "payin_status",
          transactionId: req.transactionId,
          orderId,
        },
      });

      const resp = response.data || {};
      if (resp.success === false || resp.error) {
        return {
          status: "PENDING",
          message: resolveErrorMessage(resp) || "PAYSIX status unavailable",
        };
      }

      const data = resp.data || {};
      const statusText = data.status || (typeof (resp as any).status === "string" ? (resp as any).status : undefined);
      const normalized = mapPaysixStatus(statusText);
      return {
        status: normalized,
        message: resp.message || statusText || "PAYSIX payin status",
        utr: data.utr || undefined,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          orderId,
          error: error?.message,
        },
        "[PAYSIX] Payin status check failed"
      );
      return {
        status: "PENDING",
        message: error?.message || "PAYSIX payin status check failed",
      };
    }
  }

  async checkPayoutStatus(req: StatusRequest): Promise<ProviderStatusResult> {
    const creds = this.config.credentials || {};
    const merchantId = creds.merchantId;
    const apiSecret = creds.apiSecret;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!merchantId || !apiSecret) {
      return {
        status: "PENDING",
        message: "PAYSIX credentials missing: merchantId/apiSecret",
      };
    }

    const orderId = (req.providerTransactionId || "").trim();
    if (!orderId) {
      return {
        status: "PENDING",
        message: "PAYSIX status check missing orderId",
      };
    }

    const rawBody = "";
    const { headers } = this.buildHeaders(rawBody, apiSecret, merchantId);

    try {
      const response = await this.request<PaysixStatusResponse>({
        method: "GET",
        url: buildUrl(
          baseUrl,
          `/api/payment/payout/status/${encodeURIComponent(orderId)}`
        ),
        headers,
        context: {
          action: "payout_status",
          transactionId: req.transactionId,
          orderId,
        },
      });

      const resp = response.data || {};
      if (resp.success === false || resp.error) {
        return {
          status: "PENDING",
          message: resolveErrorMessage(resp) || "PAYSIX status unavailable",
        };
      }

      const data = resp.data || {};
      const statusText = data.status || (typeof (resp as any).status === "string" ? (resp as any).status : undefined);
      const normalized = mapPaysixStatus(statusText);
      return {
        status: normalized,
        message: resp.message || statusText || "PAYSIX payout status",
        utr: data.utr || undefined,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          orderId,
          error: error?.message,
        },
        "[PAYSIX] Payout status check failed"
      );
      return {
        status: "PENDING",
        message: error?.message || "PAYSIX payout status check failed",
      };
    }
  }

  async handleWebhook(
    input: ProviderWebhookInput,
    _type: "PAYIN" | "PAYOUT" | "COMMON"
  ): Promise<ProviderWebhookResult> {
    const payload = parseJsonBody(input.rawBody || "");

    const providerTransactionId = String(
      payload.orderId || payload.order_id || payload.transactionId || payload.transaction_id || ""
    ).trim();

    if (!providerTransactionId) {
      throw new Error("PAYSIX webhook missing orderId/transactionId");
    }

    const status = mapPaysixStatus(payload.status || payload.txn_status);
    const amount = toNumber(payload.amount);
    const messageBase = payload.type === "PAYOUT" ? "Payout" : "Transaction";
    const message =
      payload.message ||
      (status === "FAILED"
        ? `${messageBase} Failed`
        : status === "PENDING"
          ? `${messageBase} Pending`
          : `${messageBase} Success`);

    return {
      type: "webhook",
      success: true,
      status,
      message,
      providerMsg: payload.status || payload.message,
      transactionId: "",
      providerTransactionId,
      amount,
      utr: payload.utr || undefined,
      metadata: {
        orderId: payload.orderId || payload.order_id,
        transactionId: payload.transactionId || payload.transaction_id,
        type: payload.type,
      },
    };
  }
}
