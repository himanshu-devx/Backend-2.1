import axios from "axios";
import crypto from "crypto";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { decryptSecret } from "@/utils/secret.util";
import { toDisplayAmount } from "@/utils/money.util";
import { getISTDate } from "@/utils/date.util";
import type { TransactionDocument } from "@/models/transaction.model";

export class MerchantCallbackService {
    static async notify(
        transaction: TransactionDocument,
        options?: { source?: string; webhookId?: string }
    ) {
        if (!transaction?.merchantId) return;
        const merchant = await CacheService.getMerchant(transaction.merchantId);
        if (!merchant) return;

        const callbackUrl =
            transaction.type === "PAYIN" ? merchant.payin?.callbackUrl : merchant.payout?.callbackUrl;
        if (!callbackUrl) return;

        const basePayload = {
            orderId: transaction.orderId,
            transactionId: transaction.id,
            amount: toDisplayAmount(transaction.amount),
            status: transaction.status,
            utr: transaction.utr,
            type: transaction.type,
            timestamp: getISTDate()
        };

        const apiSecretEncrypted = merchant.apiSecretEncrypted;
        let payload: any = basePayload;
        let headers: Record<string, string> = {};

        if (apiSecretEncrypted) {
            const apiSecret = decryptSecret(apiSecretEncrypted);
            if (apiSecret) {
                const currency = transaction.currency || "INR";
                const legacyString = `${basePayload.amount}|${currency}|${transaction.orderId}|${apiSecret}`;
                const legacyHash = crypto.createHmac("sha256", apiSecret).update(legacyString).digest("hex");
                payload = { ...basePayload, currency, hash: legacyHash };

                const timestamp = Date.now().toString();
                const rawBody = JSON.stringify(payload);
                const signature = crypto
                    .createHmac("sha256", apiSecret)
                    .update(`${rawBody}|${timestamp}`)
                    .digest("hex");

                headers = {
                    "Content-Type": "application/json",
                    "x-merchant-id": merchant.id,
                    "x-timestamp": timestamp,
                    "x-signature": signature,
                };
            } else {
                logger.warn(`[Callback] Merchant ${merchant.id} secret decryption failed; sending unsigned callback`);
            }
        }

        logger.info(
            {
                event: "callback.send",
                source: options?.source,
                webhookId: options?.webhookId,
                merchantId: merchant.id,
                transactionId: transaction.id,
                orderId: transaction.orderId,
                type: transaction.type,
                status: transaction.status,
                callbackUrl
            },
            "[Callback] Sending merchant callback"
        );

        axios.post(callbackUrl, payload, { timeout: 5000, headers }).catch(err => {
            logger.warn(
                {
                    event: "callback.failed",
                    source: options?.source,
                    webhookId: options?.webhookId,
                    merchantId: merchant.id,
                    transactionId: transaction.id,
                    orderId: transaction.orderId,
                    error: err.message
                },
                `[Callback] Failed for ${transaction.id}`
            );
        });
    }
}
