import crypto from "crypto";
import { BaseProvider } from "./base-provider";
import { logger } from "@/infra/logger-instance";
import { pickRandomCityZip } from "@/constants/city-zip.constant";
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

type SabioResponse = {
  data?: {
    upi_intent_url?: string;
    payment_request_id?: string | number;
    order_id?: string;
    payout_id?: string;
    status?: string;
    bank_reference_number?: string | null;
  };
  message?: string;
  error?: string;
  error_code?: number;
};

type SabioWebhookPayload = Record<string, string | undefined>;

const DEFAULT_BASE_URL = "https://pgbiz.sabiopg.in";

const buildSha512 = (input: string): string =>
  crypto.createHash("sha512").update(input).digest("hex").toUpperCase();

const formatAmount = (amount: number): string => amount.toFixed(2);

const buildSortedHash = (
  payload: Record<string, string | number | undefined>,
  salt: string
): string => {
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  const raw = `${salt}|${entries.map(([, value]) => String(value)).join("|")}`;
  return buildSha512(raw);
};

const parseWebhookBody = (rawBody: string): SabioWebhookPayload => {
  const trimmed = rawBody?.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to form parser
    }
  }
  const params = new URLSearchParams(trimmed);
  const payload: SabioWebhookPayload = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
};

const mapResponseCode = (code?: string): "SUCCESS" | "FAILED" | "PENDING" => {
  if (!code) return "PENDING";
  if (code === "0") return "SUCCESS";
  return "FAILED";
};

const mapStatusText = (status?: string): "SUCCESS" | "FAILED" | "PENDING" => {
  if (!status) return "PENDING";
  const normalized = status.toUpperCase();
  if (normalized === "SUCCESS") return "SUCCESS";
  if (normalized === "PENDING" || normalized === "PROCESSING") return "PENDING";
  return "FAILED";
};

export class SabioPayProvider extends BaseProvider {
  
  async handlePayin(req: PayinRequest): Promise<ProviderPayinResult> {
    const creds = this.config.credentials || {};
    const apiKey = creds.apiKey;
    const apiSalt = creds.apiSalt;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;
    const mode = req.mode || creds.mode || "LIVE";
    const currency = req.currency || creds.currency || "INR";
    const description = req.description || req.remarks || "Payment";
    const country = req.country || creds.country || "IND";
    const returnUrl = req.returnUrl || req.redirectUrl || "https://returnurl.com";
    const returnUrlFailure = req.returnUrlFailure || creds.returnUrlFailure;
    const fallbackCityZip = pickRandomCityZip();
    const city = req.city || creds.city || fallbackCityZip.city;
    const zipCode = req.zipCode || creds.zipCode || fallbackCityZip.zipCode;


    if (!apiKey || !apiSalt) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("SabioPay credentials missing: apiKey/apiSalt")
      ) as ProviderPayinResult;
    }
    if (!returnUrl) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("SabioPay config missing: returnUrl")
      ) as ProviderPayinResult;
    }
    if (!city || !zipCode) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("SabioPay config missing: city/zipCode")
      ) as ProviderPayinResult;
    }
    if (!req.customerName || !req.customerEmail || !req.customerPhone) {
      return this.formatErrorResponse(
        "payin",
        req.transactionId,
        req.amount,
        new Error("SabioPay payin missing customer details")
      ) as ProviderPayinResult;
    }

    const amountStr = formatAmount(req.amount);
    const orderId = req.transactionId;

    const hashPayload: Record<string, string | number | undefined> = {
      api_key: apiKey,
      order_id: orderId,
      mode,
      amount: amountStr,
      currency,
      description,
      name: req.customerName,
      email: req.customerEmail,
      phone: req.customerPhone,
      city,
      country,
      zip_code: zipCode,
      return_url: returnUrl,
      return_url_failure: returnUrlFailure,
    };

    const hash = buildSortedHash(hashPayload, apiSalt);

    const payload = new URLSearchParams();
    payload.set("api_key", apiKey);
    payload.set("order_id", orderId);
    if (mode) payload.set("mode", mode);
    payload.set("amount", amountStr);
    payload.set("currency", currency);
    payload.set("description", description);
    payload.set("name", req.customerName);
    payload.set("email", req.customerEmail);
    payload.set("phone", req.customerPhone);
    payload.set("return_url", returnUrl);
    payload.set("city", city);
    payload.set("country", country);
    payload.set("zip_code", zipCode);

    if (returnUrlFailure) payload.set("return_url_failure", returnUrlFailure);
    payload.set("hash", hash);

    const url = `${baseUrl.replace(/\/+$/, "")}/v2/getpaymentrequestintenturl`;

    try {
      const response = await this.request<SabioResponse>({
        method: "POST",
        url,
        data: payload.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        context: {
          action: "payin_intent",
          transactionId: req.transactionId,
          orderId: req.orderId,
        },
      });

      const upiUrl = response.data?.data?.upi_intent_url;
      if (!upiUrl) {
        throw new Error(response.data?.message || "Missing UPI intent URL");
      }

      return {
        type: "payin",
        success: true,
        status: "PENDING",
        message: "UPI intent generated",
        providerMsg: response.data?.message,
        transactionId: req.transactionId,
        providerTransactionId: String(
          response.data?.data?.payment_request_id || ""
        ),
        amount: req.amount,
        result: upiUrl,
      };
    } catch (error: any) {
      logger.error(
        { providerId: this.providerId, transactionId: req.transactionId, error: error?.message },
        "[SabioPay] Payin failed"
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
    const currency = creds.currency || "INR";

    if (!apiKey || !apiSalt) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("SabioPay credentials missing: apiKey/apiSalt")
      ) as ProviderPayoutResult;
    }
    if (
      !req.beneficiaryName ||
      !req.beneficiaryAccountNumber ||
      !req.beneficiaryBankIfsc ||
      !req.mode
    ) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("SabioPay payout missing beneficiary details/mode")
      ) as ProviderPayoutResult;
    }

    const amountStr = formatAmount(req.amount);
    const orderId = req.transactionId;
    const mode = req.mode;

    const hashPayload: Record<string, string | number | undefined> = {
      api_key: apiKey,
      order_id: orderId,
      amount: amountStr,
      currency,
      beneficiary_name: req.beneficiaryName,
      beneficiary_account_number: req.beneficiaryAccountNumber,
      beneficiary_ifsc: req.beneficiaryBankIfsc,
      mode,
    };
    const hash = buildSortedHash(hashPayload, apiSalt);

    const payload = {
      api_key: apiKey,
      order_id: orderId,
      amount: amountStr,
      currency,
      beneficiary_name: req.beneficiaryName,
      beneficiary_account_number: req.beneficiaryAccountNumber,
      beneficiary_ifsc: req.beneficiaryBankIfsc,
      beneficiary_phone: req.beneficiaryPhone,
      mode,
      purpose: req.remarks || "Payout",
      hash,
    };

    const url = `${baseUrl.replace(/\/+$/, "")}/v2/payment/payout/initiate`;

    try {
      const response = await this.request<SabioResponse>({
        method: "POST",
        url,
        data: payload,
        headers: { "Content-Type": "application/json" },
        context: {
          action: "payout_initiate",
          transactionId: req.transactionId,
        },
      });

      if ((response.data as any)?.error) {
        const errMsg =
          (response.data as any)?.error?.message || "SabioPay payout error";
        throw new Error(errMsg);
      }

      const payoutId = response.data?.data?.payout_id;
      const status = mapStatusText(response.data?.data?.status);
      const bankRef = response.data?.data?.bank_reference_number || undefined;

      return {
        type: "payout",
        success: status !== "FAILED",
        status,
        message: response.data?.message || "Payout initiated",
        providerMsg: response.data?.message,
        transactionId: req.transactionId,
        providerTransactionId: payoutId ? String(payoutId) : undefined,
        amount: req.amount,
        utr: bankRef || undefined,
      };
    } catch (error: any) {
      logger.error(
        {
          providerId: this.providerId,
          transactionId: req.transactionId,
          error: error?.message,
        },
        "[SabioPay] Payout failed"
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
      message: "Status check not supported for SabioPay",
    };
  }

  async checkPayoutStatus(_req: StatusRequest): Promise<ProviderStatusResult> {
    const req = _req;
    const creds = this.config.credentials || {};
    const apiKey = creds.apiKey;
    const apiSalt = creds.apiSalt;
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;

    if (!apiKey || !apiSalt) {
      return {
        status: "FAILED",
        message: "SabioPay credentials missing: apiKey/apiSalt",
      };
    }

    const orderId = req.transactionId;
    const hash = buildSortedHash(
      { api_key: apiKey, order_id: orderId },
      apiSalt
    );

    const payload = {
      api_key: apiKey,
      order_id: orderId,
      hash,
    };

    const url = `${baseUrl.replace(/\/+$/, "")}/v2/payment/payout/status`;

    try {
      const response = await this.request<SabioResponse>({
        method: "POST",
        url,
        data: payload,
        headers: { "Content-Type": "application/json" },
        context: {
          action: "payout_status",
          transactionId: req.transactionId,
        },
      });

      const status = mapStatusText(response.data?.data?.status);
      return {
        status,
        message: response.data?.message,
        utr: response.data?.data?.bank_reference_number || undefined,
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
    const payload = parseWebhookBody(input.rawBody || "");
    const apiSalt = this.config.credentials.apiSalt;
    if (!apiSalt) {
      throw new Error("SabioPay webhook validation failed: apiSalt missing");
    }

    if (type === "PAYOUT" || payload.payout_id) {
      const transactionId = payload.order_id || "";
      const providerTransactionId = payload.payout_id;
      const amount = payload.amount;
      const statusText = payload.status;

      const hashParts = [
        apiSalt,
        payload.payout_id,
        payload.order_id,
        payload.amount,
        payload.status,
      ].filter((value) => value !== undefined && value !== null && value !== "");
      const expectedHash = buildSha512(hashParts.join("|"));
      const receivedHash = (payload.hash || "").toString().toUpperCase();

      if (receivedHash && expectedHash !== receivedHash) {
        throw new Error("Invalid SabioPay payout webhook hash");
      }

      const status = mapStatusText(statusText);

      return {
        type: "webhook",
        success: status === "SUCCESS",
        status,
        message: payload.failure_reason || payload.status || "Webhook received",
        providerMsg: payload.status,
        transactionId: transactionId,
        providerTransactionId: providerTransactionId,
        amount: amount ? Number(amount) : undefined,
        utr: payload.bank_reference_number,
      };
    }

    const transactionId = payload.order_id || "";
    const providerTransactionId = payload.transaction_id;
    const amount = payload.amount;
    const responseCode = payload.response_code;

    const hashParts = [
      apiSalt,
      payload.transaction_id,
      payload.order_id,
      payload.amount,
      payload.response_code,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const expectedHash = buildSha512(hashParts.join("|"));
    const receivedHash = (payload.hash || "").toString().toUpperCase();

    if (receivedHash && expectedHash !== receivedHash) {
      throw new Error("Invalid SabioPay webhook hash");
    }

    const status = mapResponseCode(responseCode);

    return {
      type: "webhook",
      success: status === "SUCCESS",
      status,
      message: payload.response_message || payload.error_desc || "Webhook received",
      providerMsg: payload.response_message,
      transactionId: transactionId,
      providerTransactionId: providerTransactionId,
      amount: amount ? Number(amount) : undefined,
    };
  }
}
