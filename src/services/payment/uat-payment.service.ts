import { redis } from "@/infra/redis-instance";
import { TooManyRequests, NotFound, Conflict } from "@/utils/error";
import { PaymentError, PaymentErrorCode } from "@/utils/payment-errors.util";
import { getISTDate } from "@/utils/date.util";
import { decryptSecret } from "@/utils/secret.util";
import type { InitiatePayinDto } from "@/dto/payment/payin.dto";
import type { InitiatePayoutDto } from "@/dto/payment/payout.dto";
import type {
  PayinInitiateResponse,
  PayoutInitiateResponse,
} from "@/services/payment/payment.types";
import crypto from "crypto";
import axios from "axios";

const UAT_TTL_SECONDS = 86400;
const UAT_RATE_LIMIT_MAX = 2;
const UAT_RATE_WINDOW_MS = 1000;
const UAT_CALLBACK_DELAY_MS = 2000;

type UatTxnType = "PAYIN" | "PAYOUT";

type UatTransaction = {
  id: string;
  orderId: string;
  merchantId: string;
  type: UatTxnType;
  status: "PENDING" | "SUCCESS" | "FAILED";
  amount: number;
  currency: string;
  utr?: string;
  paymentUrl?: string;
  createdAt: string;
  updatedAt: string;
};

type UatPayinResponse = PayinInitiateResponse;
type UatPayoutResponse = PayoutInitiateResponse;

const uatTxnKey = (merchantId: string, orderId: string) =>
  `uat:txn:${merchantId}:${orderId}`;

const uatRateKey = (merchantId: string, type: UatTxnType) =>
  `uat:rl:${merchantId}:${type}`;

const makeUatId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

const buildSignature = (payload: any, apiSecret: string) => {
  const timestamp = Date.now().toString();
  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(`${rawBody}|${timestamp}`)
    .digest("hex");
  return { timestamp, signature };
};

export class UatPaymentService {
  private async enforceRateLimit(merchantId: string, type: UatTxnType) {
    const key = uatRateKey(merchantId, type);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, UAT_RATE_WINDOW_MS);
    }
    if (count > UAT_RATE_LIMIT_MAX) {
      throw TooManyRequests("UAT rate limit exceeded");
    }
  }

  private async getExisting(merchantId: string, orderId: string) {
    const cached = await redis.get(uatTxnKey(merchantId, orderId));
    return cached ? (JSON.parse(cached) as UatTransaction) : null;
  }

  async createPayin(
    merchant: any,
    data: InitiatePayinDto
  ): Promise<UatPayinResponse> {
    await this.enforceRateLimit(merchant.id, "PAYIN");

    const existing = await this.getExisting(merchant.id, data.orderId);
    if (existing) {
      throw new PaymentError(PaymentErrorCode.DUPLICATE_ORDER_ID, {
        orderId: data.orderId,
      });
    }

    const transactionId = makeUatId("UAT_PAYIN");
    const paymentUrl = `https://uat.pay/intent/${transactionId}`;

    const txn: UatTransaction = {
      id: transactionId,
      orderId: data.orderId,
      merchantId: merchant.id,
      type: "PAYIN",
      status: "PENDING",
      amount: data.amount,
      currency: "INR",
      paymentUrl,
      createdAt: getISTDate().toISOString(),
      updatedAt: getISTDate().toISOString(),
    };

    await redis.setex(
      uatTxnKey(merchant.id, data.orderId),
      UAT_TTL_SECONDS,
      JSON.stringify(txn)
    );

    this.dispatchCallback(merchant, txn);

    return {
      orderId: txn.orderId,
      transactionId: txn.id,
      paymentUrl: txn.paymentUrl!,
      amount: txn.amount,
      status: txn.status as PayinInitiateResponse["status"],
    };
  }

  async createPayout(
    merchant: any,
    data: InitiatePayoutDto
  ): Promise<UatPayoutResponse> {
    await this.enforceRateLimit(merchant.id, "PAYOUT");

    const existing = await this.getExisting(merchant.id, data.orderId);
    if (existing) {
      throw new PaymentError(PaymentErrorCode.DUPLICATE_ORDER_ID, {
        orderId: data.orderId,
      });
    }

    const transactionId = makeUatId("UAT_PAYOUT");
    const txn: UatTransaction = {
      id: transactionId,
      orderId: data.orderId,
      merchantId: merchant.id,
      type: "PAYOUT",
      status: "PENDING",
      amount: data.amount,
      currency: "INR",
      createdAt: getISTDate().toISOString(),
      updatedAt: getISTDate().toISOString(),
    };

    await redis.setex(
      uatTxnKey(merchant.id, data.orderId),
      UAT_TTL_SECONDS,
      JSON.stringify(txn)
    );

    this.dispatchCallback(merchant, txn);

    return {
      transactionId: txn.id,
      orderId: txn.orderId,
      status: txn.status as PayoutInitiateResponse["status"],
      utr: txn.utr,
    };
  }

  async getStatus(merchantId: string, orderId: string) {
    const existing = await this.getExisting(merchantId, orderId);
    if (!existing) throw NotFound("UAT transaction not found");
    return existing;
  }

  async getStatusByType(merchantId: string, orderId: string, type: UatTxnType) {
    const existing = await this.getExisting(merchantId, orderId);
    if (!existing) throw NotFound("UAT transaction not found");
    if (existing.type !== type) {
      throw Conflict("UAT transaction type mismatch");
    }
    return existing;
  }

  private dispatchCallback(merchant: any, txn: UatTransaction) {
    const callbackUrl =
      txn.type === "PAYIN"
        ? merchant.payin?.callbackUrl
        : merchant.payout?.callbackUrl;
    if (!callbackUrl) return;

    setTimeout(async () => {
      const updated: UatTransaction = {
        ...txn,
        status: "SUCCESS",
        utr: makeUatId("UAT_UTR"),
        updatedAt: getISTDate().toISOString(),
      };

      await redis.setex(
        uatTxnKey(merchant.id, txn.orderId),
        UAT_TTL_SECONDS,
        JSON.stringify(updated)
      );

      const payload: any = {
        orderId: updated.orderId,
        transactionId: updated.id,
        amount: updated.amount,
        status: updated.status,
        utr: updated.utr,
        type: updated.type,
        timestamp: getISTDate(),
      };

      const apiSecretEncrypted = merchant.apiSecretEncrypted;
      if (apiSecretEncrypted) {
        const apiSecret = decryptSecret(apiSecretEncrypted);
        if (apiSecret) {
          const currency = "INR";
          const legacyString = `${payload.amount}|${currency}|${payload.orderId}|${apiSecret}`;
          const legacyHash = crypto
            .createHmac("sha256", apiSecret)
            .update(legacyString)
            .digest("hex");
          payload.currency = currency;
          payload.hash = legacyHash;

          const { timestamp, signature } = buildSignature(payload, apiSecret);
          await axios.post(callbackUrl, payload, {
            timeout: 5000,
            headers: {
              "Content-Type": "application/json",
              "x-merchant-id": merchant.id,
              "x-timestamp": timestamp,
              "x-signature": signature,
            },
          });
          return;
        }
      }

      await axios.post(callbackUrl, payload, { timeout: 5000 });
    }, UAT_CALLBACK_DELAY_MS);
  }
}

export const uatPaymentService = new UatPaymentService();
