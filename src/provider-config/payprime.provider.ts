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

type PayprimePayoutResponse = {
  code?: number;
  status?: boolean | string | number;
  order_id?: string;
  orderId?: string;
  txn_status?: string;
  message?: string;
  utr?: string;
  data?: {
    status?: number | boolean | string;
    message?: string;
    data?: {
      orderId?: string;
      order_id?: string;
      status?: string;
      txn_status?: string;
      message?: string;
      amount?: number | string;
      utr?: string;
      transactionId?: string;
      transaction_id?: string;
    };
    amount?: number | string;
    order_id?: string;
    orderId?: string;
    txn_status?: string;
    utr?: string;
    transactionId?: string;
    transaction_id?: string;
  };
  amount?: number | string;
  transactionId?: string;
  transaction_id?: string;
};

type PayprimeWebhookPayload = Record<string, any>;

const DEFAULT_BASE_URL = "https://b2b.payprime.in/api/payout";

const buildUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const parseJsonBody = (rawBody: string): PayprimeWebhookPayload => {
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
  const payload: PayprimeWebhookPayload = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
};

const toNumber = (value?: number | string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const mapPayprimeStatus = (status?: string): ProviderStatus => {
  const normalized = (status || "").toUpperCase();
  if (
    ["SUCCESS", "COMPLETED", "PROCESSED", "PAID", "SETTLED"].includes(
      normalized
    )
  ) {
    return "SUCCESS";
  }
  if (
    ["FAILED", "FAILURE", "REJECTED", "DECLINED", "ERROR"].includes(
      normalized
    )
  ) {
    return "FAILED";
  }
  if (["INITIATED", "PENDING", "PROCESSING"].includes(normalized)) {
    return "PENDING";
  }
  return "PENDING";
};

const normalizePayoutMode = (mode?: string): "IMPS" | "NEFT" | "RTGS" => {
  const normalized = (mode || "").toUpperCase();
  if (normalized === "NEFT") return "NEFT";
  if (normalized === "RTGS") return "RTGS";
  return "IMPS";
};

const resolveString = (...values: Array<any>): string | undefined => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return undefined;
};

export class PayprimeProvider extends BaseProvider {
  async handlePayin(req: PayinRequest): Promise<ProviderPayinResult> {
    return this.formatErrorResponse(
      "payin",
      req.transactionId,
      req.amount,
      new Error("Payprime payin not supported")
    ) as ProviderPayinResult;
  }

  async handlePayout(req: PayoutRequest): Promise<ProviderPayoutResult> {
    const creds = this.config.credentials || {};
    const apiToken = creds.apiToken;
    const baseUrl = DEFAULT_BASE_URL;
    const payType = "transfer";

    if (!apiToken) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("Payprime credentials missing: apiToken")
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
        new Error("Payprime payout missing beneficiary details")
      ) as ProviderPayoutResult;
    }

    const beneDetails: Record<string, any> = {
      accountNumber: req.beneficiaryAccountNumber,
      name: req.beneficiaryName,
      bankName: req.beneficiaryBankName,
      ifsc: req.beneficiaryBankIfsc,
    };

    if (req.beneficiaryPhone) beneDetails.mobile = req.beneficiaryPhone;

    const payload = {
      token: apiToken,
      pay_type: payType,
      clientRefId: req.transactionId,
      amount: req.amount,
      mode: normalizePayoutMode(req.mode),
      note: req.remarks || "Payprime",
      beneDetails,
    };

    const url = buildUrl(baseUrl, "/initiate");

    try {
      const response = await this.request<PayprimePayoutResponse>({
        method: "POST",
        url,
        data: payload,
        headers: { "Content-Type": "application/json" },
        context: {
          action: "payout_create",
          transactionId: req.transactionId,
        },
      });

      const resp = response.data || {};
      const data = resp.data || {};
      const inner = data.data || {};

      const statusText = resolveString(
        resp.txn_status,
        data.txn_status,
        inner.status,
        typeof resp.status === "string" ? resp.status : undefined
      );
      const normalizedStatus = mapPayprimeStatus(statusText);
      const statusFlag =
        typeof resp.status === "boolean"
          ? resp.status
          : typeof data.status === "boolean"
            ? data.status
            : undefined;

      const providerOrderId = resolveString(
        resp.order_id,
        resp.orderId,
        data.order_id,
        data.orderId,
        inner.orderId,
        inner.order_id
      );

      const message =
        resp.message || data.message || inner.message || "Payprime payout";

      if (normalizedStatus === "FAILED" || statusFlag === false) {
        return {
          type: "payout",
          success: false,
          status: "FAILED",
          message: message || "Payprime payout failed",
          providerMsg: message || statusText,
          transactionId: req.transactionId,
          providerTransactionId: providerOrderId,
          amount: toNumber(resp.amount ?? data.amount ?? inner.amount) ?? req.amount,
          error: resp,
        };
      }

      return {
        type: "payout",
        success: true,
        status: normalizedStatus,
        message: message || "Payout initiated",
        providerMsg: message || statusText,
        transactionId: req.transactionId,
        providerTransactionId: providerOrderId,
        amount: toNumber(resp.amount ?? data.amount ?? inner.amount) ?? req.amount,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          error: error?.message,
        },
        "[Payprime] Payout failed"
      );
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        error
      ) as ProviderPayoutResult;
    }
  }

  async checkPayinStatus(_req: StatusRequest): Promise<ProviderStatusResult> {
    return {
      status: "PENDING",
      message: "Status check not supported for Payprime",
    };
  }

  async checkPayoutStatus(_req: StatusRequest): Promise<ProviderStatusResult> {
    const creds = this.config.credentials || {};
    const apiToken = creds.apiToken;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!apiToken) {
      return {
        status: "PENDING",
        message: "Payprime credentials missing: apiToken",
      };
    }

    const orderId = resolveString(_req.providerTransactionId, _req.transactionId);
    if (!orderId) {
      return {
        status: "PENDING",
        message: "Payprime status check missing order_id",
      };
    }

    const payload = {
      token: apiToken,
      order_id: orderId,
    };

    const url = buildUrl(baseUrl, "/check-status");

    try {
      const response = await this.request<PayprimePayoutResponse>({
        method: "GET",
        url,
        data: payload,
        headers: { "Content-Type": "application/json" },
        context: {
          action: "payout_status",
          transactionId: _req.transactionId,
        },
      });

      const resp = response.data || {};
      const data = resp.data || {};
      const inner = data.data || {};

      if (resp.code && resp.code !== 200) {
        return {
          status: "PENDING",
          message: resp.message || "Payprime status not available",
        };
      }

      const statusText = resolveString(
        resp.txn_status,
        data.txn_status,
        inner.txn_status,
        inner.status,
        data.status,
        typeof resp.status === "string" ? resp.status : undefined,
        typeof data.status === "string" ? data.status : undefined
      );
      const normalizedStatus = mapPayprimeStatus(statusText);

      const statusFlag =
        typeof resp.status === "boolean"
          ? resp.status
          : typeof data.status === "boolean"
            ? data.status
            : undefined;

      const message =
        resolveString(resp.message, data.message, inner.message) ||
        "Payprime payout status";

      const utr = resolveString(
        resp.utr,
        data.utr,
        inner.utr,
        resp.transactionId,
        resp.transaction_id,
        data.transactionId,
        data.transaction_id,
        inner.transactionId,
        inner.transaction_id
      );

      if (statusFlag === false) {
        return {
          status: "FAILED",
          message,
          utr,
        };
      }

      return {
        status: normalizedStatus,
        message,
        utr,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: _req.transactionId,
          error: error?.message,
        },
        "[Payprime] Payout status check failed"
      );
      return {
        status: "PENDING",
        message: error?.message || "Payprime status check failed",
      };
    }
  }

  async handleWebhook(
    input: ProviderWebhookInput,
    _type: "PAYIN" | "PAYOUT" | "COMMON"
  ): Promise<ProviderWebhookResult> {
    const payload = parseJsonBody(input.rawBody || "");
    const data =
      payload && typeof payload.data === "object" ? (payload.data as any) : {};
    const inner =
      data && typeof data.data === "object" ? (data.data as any) : {};

    const transactionId = resolveString(
      payload.clientRefId,
      payload.client_ref_id,
      payload.clientRefID,
      payload.clientRef,
      data.clientRefId,
      data.client_ref_id,
      inner.clientRefId,
      inner.client_ref_id,
      payload.order_id,
      payload.orderId,
      data.order_id,
      data.orderId,
      inner.order_id,
      inner.orderId
    );

    if (!transactionId) {
      throw new Error("Payprime webhook missing transaction reference");
    }

    const providerTransactionId = resolveString(
      payload.order_id,
      payload.orderId,
      data.order_id,
      data.orderId,
      inner.order_id,
      inner.orderId
    );

    const statusText = resolveString(
      payload.txn_status,
      payload.status,
      data.txn_status,
      data.status,
      inner.status
    );
    const status = mapPayprimeStatus(statusText);

    const message =
      resolveString(payload.message, data.message, inner.message) ||
      (status === "FAILED"
        ? "Payout Failed"
        : status === "PENDING"
          ? "Payout Pending"
          : "Payout Success");

    return {
      type: "webhook",
      success: true,
      status,
      message,
      providerMsg: statusText || message,
      transactionId,
      providerTransactionId,
      amount: toNumber(payload.amount ?? data.amount ?? inner.amount),
    };
  }
}
