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
    merchant_reference_number?: string;
    payout_id?: string;
    status?: string;
    transaction_id?: string;
    transaction_reference_number?: string;
    bank_reference_number?: string | null;
    error_message?: string | null;
  };
  message?: string;
  error?: {
    code?: number | string;
    message?: string;
  } | string;
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

const DUPLICATE_MERCHANT_REF_MESSAGE =
  "Merchant reference number should be unique";

const extractErrorDetails = (payload?: SabioResponse) => {
  const errorBlock = payload?.error;
  const errorCode =
    payload?.error_code ??
    (typeof errorBlock === "object" ? errorBlock?.code : undefined);
  const errorMessage =
    (typeof errorBlock === "object" ? errorBlock?.message : undefined) ||
    (typeof errorBlock === "string" ? errorBlock : undefined) ||
    payload?.message ||
    payload?.data?.error_message;
  return { errorCode, errorMessage };
};

const isDuplicateMerchantRefError = (payload?: SabioResponse): boolean => {
  if (!payload) return false;
  const { errorCode, errorMessage } = extractErrorDetails(payload);
  if (errorCode !== undefined && String(errorCode) === "1003") return true;
  if (
    errorMessage &&
    errorMessage
      .toLowerCase()
      .includes(DUPLICATE_MERCHANT_REF_MESSAGE.toLowerCase())
  ) {
    return true;
  }
  return false;
};

const mapResponseCode = (code?: string): "SUCCESS" | "FAILED" | "PENDING" => {
  if (!code) return "PENDING";
  if (code === "0") return "SUCCESS";
  return "FAILED";
};

const mapStatusText = (status?: string): "SUCCESS" | "FAILED" | "PENDING" => {
  if (!status) return "PENDING";
  const normalized = status.toUpperCase();
  if (["SUCCESS", "SENT_TO_BENEFICIARY"].includes(normalized)) return "SUCCESS";
  if (["PROCESSING", "INCOMPLETE", "PENDING"].includes(normalized)) return "PENDING";
  if (["FAILED", "FAILURE", "RETURNED_FROM_BENEFICIARY"].includes(normalized)) return "FAILED";
  return "PENDING";
};

const resolveTransferType = (mode?: string, amount?: number): "NEFT" | "IMPS" => {
  if (amount && amount > 200000) return "NEFT";
  const normalized = (mode || "").toUpperCase();
  if (normalized === "NEFT") return "NEFT";
  if (normalized === "IMPS") return "IMPS";
  if (normalized === "RTGS") return "NEFT";
  if (normalized === "UPI") return "IMPS";
  if (amount && amount > 200000) return "NEFT";
  return "IMPS";
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
      !req.beneficiaryBankIfsc
    ) {
      return this.formatErrorResponse(
        "payout",
        req.transactionId,
        req.amount,
        new Error("SabioPay payout missing beneficiary details")
      ) as ProviderPayoutResult;
    }

    const amountStr = formatAmount(req.amount);
    const orderId = req.transactionId;
    const transferType = resolveTransferType(req.mode, req.amount);

    const hashPayload: Record<string, string | number | undefined> = {
      api_key: apiKey,
      merchant_reference_number: orderId,
      amount: amountStr,
      transfer_type: transferType,
      account_name: req.beneficiaryName,
      account_number: req.beneficiaryAccountNumber,
      ifsc_code: req.beneficiaryBankIfsc,
      bank_name: req.beneficiaryBankName,
    };
    const hash = buildSortedHash(hashPayload, apiSalt);

    const payload = new URLSearchParams();
    payload.set("api_key", apiKey);
    payload.set("merchant_reference_number", orderId);
    payload.set("amount", amountStr);
    payload.set("transfer_type", transferType);
    payload.set("account_name", req.beneficiaryName);
    payload.set("account_number", req.beneficiaryAccountNumber);
    payload.set("ifsc_code", req.beneficiaryBankIfsc);
    if (req.beneficiaryBankName) {
      payload.set("bank_name", req.beneficiaryBankName);
    }
    if (hash) payload.set("hash", hash);

    const url = `${baseUrl.replace(/\/+$/, "")}/v3/fundtransfer`;

    try {
      const response = await this.request<SabioResponse>({
        method: "POST",
        url,
        data: payload.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        context: {
          action: "payout_initiate",
          transactionId: req.transactionId,
        },
      });

      const responsePayload = response.data as SabioResponse;
      const duplicateRef = isDuplicateMerchantRefError(responsePayload);
      if (duplicateRef) {
        const { errorMessage } = extractErrorDetails(responsePayload);
        logger.warn(
          {
            providerId: this.providerId,
            transactionId: req.transactionId,
            error: errorMessage,
          },
          "[SabioPay] Duplicate merchant reference, treating as pending"
        );
        return {
          type: "payout",
          success: true,
          status: "PENDING",
          message:
            errorMessage ||
            "Duplicate merchant reference number, treating as pending",
          providerMsg: errorMessage || responsePayload.message,
          transactionId: req.transactionId,
          providerTransactionId: responsePayload.data?.transaction_id
            ? String(responsePayload.data?.transaction_id)
            : undefined,
          amount: req.amount,
        };
      }

      const errorCode = (responsePayload as any)?.error_code;
      if (errorCode && String(errorCode) !== "0") {
        const errMsg =
          (responsePayload as any)?.error?.message ||
          responsePayload?.message ||
          `SabioPay payout error (${errorCode})`;
        throw new Error(errMsg);
      }

      if ((responsePayload as any)?.error) {
        const errorBlock = (responsePayload as any)?.error;
        const errMsg =
          errorBlock?.message ||
          (typeof errorBlock === "string" ? errorBlock : null) ||
          "SabioPay payout error";
        throw new Error(errMsg);
      }

      const responseData = responsePayload?.data || {};
      const payoutId =
        responseData.transaction_id ||
        responseData.transaction_reference_number ||
        responseData.payout_id;
      const status = mapStatusText(responseData.status);
      const bankRef = responseData.bank_reference_number || undefined;
      const errorMessage =
        responseData.error_message ||
        response.data?.message ||
        (status === "FAILED" ? "SabioPay payout failed" : undefined);
      const message =
        errorMessage ||
        response.data?.message ||
        (status === "PENDING" ? "Payout processing" : "Payout initiated");
      const providerMsg =
        responsePayload?.message || responseData.error_message || "Sabio Failed";

      return {
        type: "payout",
        success: status !== "FAILED",
        status,
        message,
        providerMsg,
        transactionId: req.transactionId,
        providerTransactionId: payoutId ? String(payoutId) : undefined,
        amount: req.amount,
        utr: bankRef || undefined,
      };
    } catch (error: any) {
      const errorPayload = error?.response?.data as SabioResponse | undefined;
      const hasDuplicateMessage =
        !!error?.message &&
        String(error.message)
          .toLowerCase()
          .includes(DUPLICATE_MERCHANT_REF_MESSAGE.toLowerCase());
      if (isDuplicateMerchantRefError(errorPayload) || hasDuplicateMessage) {
        const { errorMessage } = extractErrorDetails(errorPayload);
        const resolvedMessage =
          errorMessage ||
          (hasDuplicateMessage ? error.message : undefined);
        logger.warn(
          {
            providerId: this.providerId,
            transactionId: req.transactionId,
            error: resolvedMessage,
          },
          "[SabioPay] Duplicate merchant reference, treating as pending"
        );
        return {
          type: "payout",
          success: true,
          status: "PENDING",
          message:
            resolvedMessage ||
            "Duplicate merchant reference number, treating as pending",
          providerMsg: resolvedMessage || errorPayload?.message,
          transactionId: req.transactionId,
          providerTransactionId: errorPayload?.data?.transaction_id
            ? String(errorPayload?.data?.transaction_id)
            : undefined,
          amount: req.amount,
        };
      }
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
      { api_key: apiKey, merchant_reference_number: orderId },
      apiSalt
    );

    const payload = new URLSearchParams();
    payload.set("api_key", apiKey);
    payload.set("merchant_reference_number", orderId);
    if (hash) payload.set("hash", hash);

    const url = `${baseUrl.replace(/\/+$/, "")}/v3/fundtransferstatus`;

    try {
      const response = await this.request<SabioResponse>({
        method: "POST",
        url,
        data: payload.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        context: {
          action: "payout_status",
          transactionId: req.transactionId,
        },
      });

      if ((response.data as any)?.error) {
        const errorBlock = (response.data as any)?.error;
        const errorMsg =
          errorBlock?.message ||
          (typeof errorBlock === "string" ? errorBlock : null) ||
          "Status check failed";
        return {
          status: "FAILED",
          message: errorMsg,
        };
      }

      const status = mapStatusText(response.data?.data?.status);
      return {
        status,
        message: response.data?.message,
        utr:
          response.data?.data?.bank_reference_number ||
          response.data?.data?.transaction_reference_number ||
          response.data?.data?.transaction_id ||
          undefined,
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

    const isPayoutWebhook =
      type === "PAYOUT" ||
      !!payload.payout_id ||
      !!payload.merchant_reference_number ||
      !!payload.transaction_reference_number;

    if (isPayoutWebhook) {
      const transactionId =
        payload.merchant_reference_number ||
        payload.order_id ||
        "";
      const providerTransactionId =
        payload.transaction_reference_number ||
        payload.payout_id ||
        payload.transaction_id;
      const amount = payload.transaction_amount || payload.amount;
      const statusText = payload.status;
      const status = mapStatusText(statusText);

      return {
        type: "webhook",
        success: status === "SUCCESS",
        status,
        message:
          payload.error_message ||
          payload.failure_reason ||
          payload.status ||
          "Webhook received",
        providerMsg: payload.status,
        transactionId: transactionId,
        providerTransactionId: providerTransactionId,
        amount: amount ? Number(amount) : undefined,
        utr: payload.bank_reference_number || payload.transaction_id,
      };
    }

    // PAYIN webhook handling
    const transactionId = payload.order_id || "";
    const providerTransactionId = payload.transaction_id;
    const amount = payload.amount;
    const responseCode = payload.response_code;

    const status = mapResponseCode(responseCode?.toString());

    // Determine the appropriate message
    let message = "Webhook received";
    if (status === "FAILED" && payload.error_desc) {
      message = payload.error_desc;
    } else if (payload.response_message) {
      message = payload.response_message;
    }

    return {
      type: "webhook",
      success: status === "SUCCESS",
      status,
      message,
      providerMsg: payload.response_message,
      transactionId: transactionId,
      providerTransactionId: providerTransactionId,
      amount: amount ? Number(amount) : undefined,
      utr: payload.bank_ref_id, // Use bank_ref_id for payin
      metadata: {
        customer_vpa: payload.customer_vpa,
        payment_mode: payload.payment_mode,
        payment_channel: payload.payment_channel,
        payment_datetime: payload.payment_datetime,
        cardmasked: payload.cardmasked,
      },
    };
  }
}
