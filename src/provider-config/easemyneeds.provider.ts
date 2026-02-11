import crypto from "crypto";
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

type EaseMyNeedsResponse<T = any> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type PayinCreateData = {
  payment_id?: string;
  amount?: number | string;
  payment_mode?: string;
  status?: string;
  payment_link?: string;
  remarks?: string;
  customer_name?: string;
  customer_details?: {
    customer_email?: string;
    customer_phone?: string;
  };
  callback_url?: string;
  redirect_url?: string;
  ref_id?: string;
};

type StatusData = {
  payment_id?: string;
  request_id?: string;
  utr_number?: string;
  status?: string;
  amount?: number | string;
  requested_amount?: number | string;
  ref_id?: string;
  message?: string;
};

type WebhookPayinPayload = {
  payment_id?: string;
  currency?: string;
  status?: string;
  amount?: number | string;
  payment_method?: string;
  payment_time?: string;
  utr_number?: string;
  payment_message?: string;
  ref_id?: string;
};

type WebhookPayoutPayload = {
  request_id?: string;
  amount?: number | string;
  status?: string;
  payment_message?: string;
  utr_number?: string;
  ref_id?: string;
};

const DEFAULT_BASE_URL = "https://dboard.easemyneeds.in/api/v1";
const AES_ALGO = "aes-256-cbc";

const buildUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const isHex = (value: string) => /^[0-9a-fA-F]+$/.test(value);

const toSizedBuffer = (value: string, size: number): Buffer => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Encryption key/iv cannot be empty");

  const hexCandidate = trimmed.length === size * 2 && isHex(trimmed);
  const buf = Buffer.from(trimmed, hexCandidate ? "hex" : "utf8");

  if (buf.length === size) return buf;
  if (buf.length > size) return buf.subarray(0, size);

  const padded = Buffer.alloc(size);
  buf.copy(padded);
  return padded;
};

const encryptPayload = (
  payload: Record<string, any>,
  apiKey: string,
  apiSalt: string
): string => {
  const key = toSizedBuffer(apiKey, 32);
  const iv = toSizedBuffer(apiSalt, 16);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return encrypted.toString("base64");
};

const tryDecryptPayload = (
  payload: string,
  apiKey: string,
  apiSalt: string
): Record<string, any> | null => {
  const attempts: Array<{ key: string; iv: string }> = [
    { key: apiKey, iv: apiSalt },
    { key: apiSalt, iv: apiKey },
  ];

  for (const attempt of attempts) {
    try {
      const key = toSizedBuffer(attempt.key, 32);
      const iv = toSizedBuffer(attempt.iv, 16);
      const decipher = crypto.createDecipheriv(AES_ALGO, key, iv);
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload, "base64")),
        decipher.final(),
      ]);
      const parsed = JSON.parse(decrypted.toString("utf8"));
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, any>;
      }
    } catch {
      // try next attempt
    }
  }
  return null;
};

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

const mapPayinMode = (mode?: string): "INTENT" | "IMPS_TRANSFER" => {
  const normalized = (mode || "").toUpperCase();
  if (normalized === "IMPS_TRANSFER" || normalized === "IMPS") {
    return "IMPS_TRANSFER";
  }
  return "INTENT";
};

const mapPayoutMode = (mode?: string): "IMPS" | "NEFT" | "RTGS" => {
  const normalized = (mode || "").toUpperCase();
  if (normalized === "NEFT") return "NEFT";
  if (normalized === "RTGS") return "RTGS";
  return "IMPS";
};

const mapEaseMyNeedsStatus = (status?: string): ProviderStatus => {
  const normalized = (status || "").toUpperCase();
  if (
    ["SUCCESS", "PROCESSED", "COMPLETED", "CAPTURED", "PAID", "SETTLED"].includes(
      normalized
    )
  ) {
    return "SUCCESS";
  }
  if (["EXPIRED", "TIMEOUT", "CANCELLED", "DELETED"].includes(normalized)) {
    return "EXPIRED";
  }
  if (
    ["FAILED", "FAILURE", "REJECTED", "DECLINED", "ERROR", "REFUNDED", "REFUND"].includes(
      normalized
    )
  ) {
    return "FAILED";
  }
  return "PENDING";
};

export class EaseMyNeedsProvider extends BaseProvider {
  async handlePayin(req: PayinRequest): Promise<ProviderPayinResult> {
    const creds = this.config.credentials || {};
    const apiKey = creds.apiKey;
    const apiSalt = creds.apiSalt;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!apiKey || !apiSalt) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("EaseMyNeeds credentials missing: apiKey/apiSalt")
      ) as ProviderPayinResult;
    }

    if (!req.customerName || !req.customerEmail || !req.customerPhone) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("EaseMyNeeds payin missing customer details")
      ) as ProviderPayinResult;
    }

    if (!req.callbackUrl) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("EaseMyNeeds payin missing callbackUrl")
      ) as ProviderPayinResult;
    }

    const payload = {
      amount: req.amount,
      payment_mode: mapPayinMode(req.paymentMode || req.mode),
      callback_url: req.callbackUrl,
      redirect_url: req.redirectUrl || req.returnUrl || "https://goole.com",
      customer_name: req.customerName,
      customer_details: {
        customer_email: req.customerEmail,
        customer_phone: req.customerPhone,
      },
      ref_id: req.transactionId,
      remarks: req.remarks || "Payin",
    };

    const encrypted = encryptPayload(payload, apiKey, apiSalt);
    const url = buildUrl(baseUrl, "/create-payment");

    try {
      const response = await this.request<EaseMyNeedsResponse<PayinCreateData>>({
        method: "POST",
        url,
        data: { payload: encrypted },
        headers: {
          "X-Api-Key": apiKey,
          "X-Api-Salt": apiSalt,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        context: {
          action: "payin_create",
          transactionId: req.transactionId,
          orderId: req.orderId,
        },
      });

      const resp = response.data;
      if (resp?.success === false) {
        throw new Error(resp?.message || "EaseMyNeeds payin failed");
      }

      const data = resp?.data || {};
      const paymentLink = data.payment_link;
      if (!paymentLink) {
        throw new Error(resp?.message || "Missing payment link in response");
      }

      const status = mapEaseMyNeedsStatus(data.status);

      return {
        type: "payin",
        success: status !== "FAILED",
        status,
        message: resp?.message || "Payment initiated",
        providerMsg: resp?.message,
        transactionId: req.transactionId,
        providerTransactionId: data.payment_id,
        amount: req.amount,
        result: paymentLink,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          error: error?.message,
        },
        "[EaseMyNeeds] Payin failed"
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
    const apiKey = creds.apiKey;
    const apiSalt = creds.apiSalt;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!apiKey || !apiSalt) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("EaseMyNeeds credentials missing: apiKey/apiSalt")
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
        new Error("EaseMyNeeds payout missing beneficiary details")
      ) as ProviderPayoutResult;
    }

    const payload = {
      amount: req.amount,
      payment_mode: mapPayoutMode(req.mode),
      beneficiary_ifsc: req.beneficiaryBankIfsc,
      beneficiary_acc_number: req.beneficiaryAccountNumber,
      beneficiary_bank_name: req.beneficiaryBankName,
      beneficiary_name: req.beneficiaryName,
      beneficiary_address: undefined,
      ref_id: req.transactionId,
      remarks: req.remarks || "Payout",
    };

    const encrypted = encryptPayload(payload, apiKey, apiSalt);
    const url = buildUrl(baseUrl, "/payout/request-payout");

    try {
      const response = await this.request<EaseMyNeedsResponse<StatusData>>({
        method: "POST",
        url,
        data: { payload: encrypted },
        headers: {
          "X-Api-Key": apiKey,
          "X-Api-Salt": apiSalt,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        context: {
          action: "payout_request",
          transactionId: req.transactionId,
        },
      });

      const resp = response.data;
      if (resp?.success === false) {
        throw new Error(resp?.message || "EaseMyNeeds payout failed");
      }

      const data = resp?.data || {};
      const status = mapEaseMyNeedsStatus(data.status);

      return {
        type: "payout",
        success: status !== "FAILED",
        status,
        message: resp?.message || "Payout initiated",
        providerMsg: resp?.message,
        transactionId: req.transactionId,
        providerTransactionId: data.request_id || data.payment_id,
        amount: req.amount,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          error: error?.message,
        },
        "[EaseMyNeeds] Payout failed"
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
    const apiKey = creds.apiKey;
    const apiSalt = creds.apiSalt;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!apiKey || !apiSalt) {
      return {
        status: "FAILED",
        message: "EaseMyNeeds credentials missing: apiKey/apiSalt",
      };
    }

    const url = buildUrl(baseUrl, "/get-status");
    const payload = req.providerTransactionId
      ? { payment_id: req.providerTransactionId }
      : { ref_id: req.transactionId };

    try {
      const response = await this.request<EaseMyNeedsResponse<StatusData>>({
        method: "POST",
        url,
        data: payload,
        headers: {
          "X-Api-Key": apiKey,
          "X-Api-Salt": apiSalt,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        context: {
          action: "payin_status",
          transactionId: req.transactionId,
        },
      });

      const data = response.data?.data || {};
      const status = mapEaseMyNeedsStatus(data.status);
      return {
        status,
        message: response.data?.message || data.message,
        utr: data.utr_number,
      };
    } catch (error: any) {
      return {
        status: "PENDING",
        message: error?.message || "Status check failed",
      };
    }
  }

  async checkPayoutStatus(req: StatusRequest): Promise<ProviderStatusResult> {
    const creds = this.config.credentials || {};
    const apiKey = creds.apiKey;
    const apiSalt = creds.apiSalt;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!apiKey || !apiSalt) {
      return {
        status: "FAILED",
        message: "EaseMyNeeds credentials missing: apiKey/apiSalt",
      };
    }

    const url = buildUrl(baseUrl, "/payout/get-status");
    const payload = req.providerTransactionId
      ? { request_id: req.providerTransactionId }
      : { ref_id: req.transactionId };

    try {
      const response = await this.request<EaseMyNeedsResponse<StatusData>>({
        method: "POST",
        url,
        data: payload,
        headers: {
          "X-Api-Key": apiKey,
          "X-Api-Salt": apiSalt,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        context: {
          action: "payout_status",
          transactionId: req.transactionId,
        },
      });

      const data = response.data?.data || {};
      const status = mapEaseMyNeedsStatus(data.status);
      return {
        status,
        message: response.data?.message || data.message,
        utr: data.utr_number,
      };
    } catch (error: any) {
      return {
        status: "PENDING",
        message: error?.message || "Status check failed",
      };
    }
  }

  async handleWebhook(
    input: ProviderWebhookInput,
    type: "PAYIN" | "PAYOUT" | "COMMON"
  ): Promise<ProviderWebhookResult> {
    const creds = this.config.credentials || {};
    const apiKey = creds.apiKey;
    const apiSalt = creds.apiSalt;

    if (!apiKey || !apiSalt) {
      throw new Error("EaseMyNeeds webhook validation failed: apiKey/apiSalt missing");
    }

    const body = parseJsonBody(input.rawBody);
    const payloadField = body?.payload;
    const decrypted =
      typeof payloadField === "string"
        ? tryDecryptPayload(payloadField, apiKey, apiSalt)
        : null;
    const payload = decrypted || body;

    if (type === "PAYOUT" || payload?.request_id) {
      const payout = payload as WebhookPayoutPayload;
      const status = mapEaseMyNeedsStatus(payout.status);

      return {
        type: "webhook",
        success: status === "SUCCESS",
        status,
        message: payout.payment_message || payout.status || "Webhook received",
        providerMsg: payout.payment_message,
        transactionId: payout.ref_id || payout.request_id || "",
        providerTransactionId: payout.request_id,
        amount: payout.amount ? Number(payout.amount) : undefined,
        utr: payout.utr_number,
      };
    }

    const payin = payload as WebhookPayinPayload;
    const status = mapEaseMyNeedsStatus(payin.status);

    return {
      type: "webhook",
      success: status === "SUCCESS",
      status,
      message: payin.payment_message || payin.status || "Webhook received",
      providerMsg: payin.payment_message,
      transactionId: payin.ref_id || payin.payment_id || "",
      providerTransactionId: payin.payment_id,
      amount: payin.amount ? Number(payin.amount) : undefined,
      utr: payin.utr_number,
    };
  }
}
