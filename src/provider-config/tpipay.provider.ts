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

type TpipayCreateResponse = {
  status?: string;
  order_id?: string;
  gateway_order_id?: string | number;
  gatewayOrderId?: string | number;
  qrString?: string;
  qr_string?: string;
  amount?: number;
  message?: string;
  data?: {
    status?: string;
    order_id?: string;
    gateway_order_id?: string | number;
    gatewayOrderId?: string | number;
    qrString?: string;
    qr_string?: string;
    amount?: number;
    message?: string;
  };
  errors?: Record<string, string[]>;
};

type TpipayStatusResponse = {
  status?: string;
  data?: {
    type?: string;
    status?: string;
    order_id?: string;
    amount?: number;
    utr?: string | null;
    date?: string;
    time?: string;
  };
  message?: string;
};

type TpipayPayoutCreateResponse = {
  status?: string | number;
  message?: string;
  data?: {
    status?: string;
    message?: string;
    amount?: number;
    txnStatusDesc?: string;
    bank_ref_no?: string;
    externalTxnId?: string;
    payeeName?: string;
    payeeAccount?: string;
    payeeIfsc?: string;
  };
};

type TpipayPayoutStatusResponse = {
  status?: string;
  txnStatus?: string;
  amount?: number;
  utr?: string;
  externalRef?: string;
  message?: string;
};

type TpipayWebhookPayload = {
  type?: string;
  status?: string;
  order_id?: string;
  orderId?: string;
  transaction_id?: string;
  externalTxnId?: string;
  amount?: number | string;
  utr?: string;
  bank_ref_no?: string;
  message?: string;
  gateway_order_id?: string | number;
  gatewayOrderId?: string | number;
};

const DEFAULT_BASE_URL = "https://banking.mytpipay.com/api/upi-collection";
const DEFAULT_PAYOUT_BASE_URL = "https://banking.mytpipay.com/api/payout/v1";

const buildUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const parseJsonBody = (rawBody: string): Record<string, any> => {
  if (!rawBody) return {};
  const trimmed = rawBody.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const params = new URLSearchParams(trimmed);
    const payload: Record<string, any> = {};
    for (const [key, value] of params.entries()) {
      payload[key] = value;
    }
    return payload;
  }
};

const mapTpipayStatus = (status?: string): ProviderStatus => {
  const normalized = (status || "").toUpperCase();
  if (["CREDIT", "SUCCESS", "PAID", "SETTLED"].includes(normalized)) {
    return "SUCCESS";
  }
  if (["FAILED", "FAILURE", "REJECTED", "DECLINED"].includes(normalized)) {
    return "FAILED";
  }
  if (["INITIATED", "PENDING", "PROCESSING"].includes(normalized)) {
    return "PENDING";
  }
  return "PENDING";
};

const toNumber = (value?: number | string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const resolveNumericId = (...candidates: Array<string | undefined>): string | null => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (trimmed && /^[0-9]+$/.test(trimmed)) return trimmed;
  }
  return null;
};

const normalizePayoutMode = (mode?: string): "IMPS" | "NEFT" | "RTGS" => {
  const normalized = (mode || "").toUpperCase();
  if (normalized === "NEFT") return "NEFT";
  if (normalized === "RTGS") return "RTGS";
  return "IMPS";
};


export class TpipayProvider extends BaseProvider {
  async handlePayin(req: PayinRequest): Promise<ProviderPayinResult> {
    const creds = this.config.credentials || {};
    const apiToken = creds.apiToken;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!apiToken) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("TPIPAY credentials missing: apiToken")
      ) as ProviderPayinResult;
    }

    if (!req.customerName || !req.customerEmail || !req.customerPhone) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("TPIPAY payin missing customer details")
      ) as ProviderPayinResult;
    }

    const providerOrderId =
      resolveNumericId(req.transactionId, req.orderId) ||
      `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const payload: Record<string, any> = {
      api_token: apiToken,
      amount: req.amount,
      mobile: req.customerPhone,
      name: req.customerName,
      email: req.customerEmail,
      order_id: providerOrderId,
    };

    if (req.callbackUrl) {
      payload.callback_url = req.callbackUrl;
    }

    const url = buildUrl(baseUrl, "/createorder");

    try {
      const response = await this.request<TpipayCreateResponse>({
        method: "POST",
        url,
        data: payload,
        headers: { "Content-Type": "application/json" },
        context: {
          action: "payin_create",
          transactionId: req.transactionId,
          orderId: req.orderId,
        },
      });

      const resp = response?.data || {};
      const data = resp?.data || {};
      const statusRaw = resp.status || data.status || "";
      const statusNormalized = statusRaw.toLowerCase();
      const qrString =
        resp.qrString ||
        resp.qr_string ||
        data.qrString ||
        data.qr_string;
      const gatewayOrderId =
        resp.gateway_order_id ??
        data.gateway_order_id ??
        resp.order_id ??
        data.order_id ??
        data.gatewayOrderId ??
        resp.gatewayOrderId;

      const isSuccess =
        statusNormalized === "success" ||
        (!!qrString &&
          statusNormalized !== "failed" &&
          statusNormalized !== "validation_error");

      if (!isSuccess) {
        const isValidationError = statusNormalized === "validation_error";
        const message =
          resp.message ||
          data.message ||
          (isValidationError ? "TPIPAY validation error" : "TPIPAY payin failed");

        return {
          type: "payin",
          success: false,
          status: "FAILED",
          message,
          providerMsg: resp.message,
          transactionId: req.transactionId,
          providerTransactionId: providerOrderId,
          amount: req.amount,
          error: resp,
        };
      }

      if (!qrString) {
        throw new Error("Missing TPIPAY QR string");
      }

      return {
        type: "payin",
        success: true,
        status: "PENDING",
        message: resp.message || data.message || "Transaction Created",
        providerMsg: resp.message || data.message,
        transactionId: req.transactionId,
        providerTransactionId: providerOrderId,
        amount: toNumber(resp.amount ?? data.amount) ?? req.amount,
        result: qrString,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          error: error?.message,
        },
        "[TPIPAY] Payin failed"
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
    const apiToken = creds.apiToken;
    const baseUrl = creds.payoutBaseUrl || DEFAULT_PAYOUT_BASE_URL;

    if (!apiToken) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("TPIPAY credentials missing: apiToken")
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
        new Error("TPIPAY payout missing beneficiary details")
      ) as ProviderPayoutResult;
    }

    const payload: Record<string, any> = {
      api_token: apiToken,
      amount: req.amount,
      transfer_mode: normalizePayoutMode(req.mode),
      externalTxnId: req.transactionId,
      payee_name: req.beneficiaryName,
      payee_account: req.beneficiaryAccountNumber,
      payee_ifsc: req.beneficiaryBankIfsc,
      payee_ac_type: "savings",
      payee_bank_name: req.beneficiaryBankName,
    };

    const url = buildUrl(baseUrl, "/createOrder");

    try {
      const response = await this.request<TpipayPayoutCreateResponse>({
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
      const statusText =
        data.status ||
        (typeof resp.status === "string" ? resp.status : undefined) ||
        (resp.status === 200 ? "success" : resp.status ? "failure" : undefined);
      const normalizedStatus = mapTpipayStatus(statusText);
      const success = normalizedStatus !== "FAILED";
      const message = data.message || resp.message;

      if (!success) {
        return {
          type: "payout",
          success: false,
          status: "FAILED",
          message: message || "TPIPAY payout failed",
          providerMsg: message || statusText,
          transactionId: req.transactionId,
          providerTransactionId: data.externalTxnId || payload.externalTxnId,
          amount: toNumber(data.amount) ?? req.amount,
          utr: data.bank_ref_no,
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
        providerTransactionId: data.externalTxnId || payload.externalTxnId,
        amount: toNumber(data.amount) ?? req.amount,
        utr: data.bank_ref_no,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          error: error?.message,
        },
        "[TPIPAY] Payout failed"
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
    const apiToken = creds.apiToken;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;
    const orderId = req.transactionId || req.providerTransactionId;

    if (!apiToken) {
      return {
        status: "FAILED",
        message: "TPIPAY credentials missing: apiToken",
      };
    }

    if (!orderId) {
      return {
        status: "FAILED",
        message: "TPIPAY status check missing order_id",
      };
    }

    const payload = {
      api_token: apiToken,
      order_id: orderId,
    };

    const url = buildUrl(baseUrl, "/check-trxn-status");

    try {
      const response = await this.request<TpipayStatusResponse>({
        method: "POST",
        url,
        data: payload,
        headers: { "Content-Type": "application/json" },
        context: {
          action: "payin_status",
          transactionId: req.transactionId,
        },
      });

      const resp = response.data || {};

      if (resp.status !== "success") {
        return {
          status: "FAILED",
          message: resp.message || "TPIPAY status check failed",
        };
      }

      const data = resp.data || {};
      return {
        status: mapTpipayStatus(data.status),
        message: data.status || "TPIPAY status",
        utr: data.utr || undefined,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          error: error?.message,
        },
        "[TPIPAY] Status check failed"
      );
      return {
        status: "FAILED",
        message: error?.message || "TPIPAY status check failed",
      };
    }
  }

  async checkPayoutStatus(_req: StatusRequest): Promise<ProviderStatusResult> {
    const creds = this.config.credentials || {};
    const apiToken = creds.apiToken;
    const baseUrl = creds.payoutBaseUrl || DEFAULT_PAYOUT_BASE_URL;
    const externalRef = _req.providerTransactionId || _req.transactionId;

    if (!apiToken) {
      return {
        status: "FAILED",
        message: "TPIPAY credentials missing: apiToken",
      };
    }

    if (!externalRef) {
      return {
        status: "FAILED",
        message: "TPIPAY status check missing externalRef",
      };
    }

    const params = new URLSearchParams({
      api_token: apiToken,
      type: "status-check",
      externalRef,
    });

    const url = `${buildUrl(baseUrl, "/status-check")}?${params.toString()}`;

    try {
      const response = await this.request<TpipayPayoutStatusResponse>({
        method: "GET",
        url,
        headers: { "Content-Type": "application/json" },
        context: {
          action: "payout_status",
          transactionId: _req.transactionId,
        },
      });

      const resp = response.data || {};
      const statusText = resp.status || resp.txnStatus;
      const normalized = mapTpipayStatus(statusText);

      return {
        status: normalized,
        message: resp.message || statusText || "TPIPAY payout status",
        utr: resp.utr,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: _req.transactionId,
          error: error?.message,
        },
        "[TPIPAY] Payout status check failed"
      );
      return {
        status: "FAILED",
        message: error?.message || "TPIPAY payout status check failed",
      };
    }
  }

  async handleWebhook(
    input: ProviderWebhookInput,
    type: "PAYIN" | "PAYOUT" | "COMMON"
  ): Promise<ProviderWebhookResult> {
    const payload = parseJsonBody(input.rawBody) as TpipayWebhookPayload;

    const transactionId = String(
      payload.order_id ||
        payload.orderId ||
        payload.externalTxnId ||
        payload.transaction_id ||
        ""
    ).trim();
    if (!transactionId) {
      throw new Error("TPIPAY webhook missing order_id");
    }

    const status = mapTpipayStatus(payload.status);
    const amount = toNumber(payload.amount);
    const messageBase = type === "PAYOUT" ? "Payout" : "Transaction";
    const message =
      payload.message ||
      (status === "FAILED"
        ? `${messageBase} Failed`
        : status === "PENDING"
          ? `${messageBase} Pending`
          : `${messageBase} Success`);
    const providerTransactionId =
      payload.gateway_order_id ??
      payload.gatewayOrderId ??
      payload.order_id ??
      payload.externalTxnId ??
      payload.transaction_id;

    return {
      type: "webhook",
      success: true,
      status,
      message,
      providerMsg: payload.message || payload.status,
      transactionId,
      providerTransactionId: providerTransactionId
        ? String(providerTransactionId)
        : undefined,
      amount,
      utr: payload.utr || payload.bank_ref_no,
      
    };
  }
}
