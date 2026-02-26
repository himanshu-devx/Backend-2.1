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
        options?: {
            source?: string;
            webhookId?: string;
            reason?: string;
            actor?: { id: string; email?: string; role?: string };
        }
    ) {
        try {
            if (!transaction?.merchantId) {
                logger.warn(
                    {
                        event: "callback.skip",
                        reason: "missing_merchant_id",
                        transactionId: transaction?.id,
                        orderId: transaction?.orderId
                    },
                    "[Callback] Skipped merchant callback"
                );
                return;
            }
            if (transaction.status === "PENDING" || transaction.status === "PROCESSING") {
                logger.info(
                    {
                        event: "callback.skip",
                        reason: "status_pending",
                        transactionId: transaction.id,
                        orderId: transaction.orderId,
                        status: transaction.status
                    },
                    "[Callback] Skipped merchant callback"
                );
                return;
            }
            const merchant = await CacheService.getMerchant(transaction.merchantId);
            if (!merchant) {
                logger.warn(
                    {
                        event: "callback.skip",
                        reason: "merchant_not_found",
                        merchantId: transaction.merchantId,
                        transactionId: transaction.id,
                        orderId: transaction.orderId
                    },
                    "[Callback] Skipped merchant callback"
                );
                return;
            }

            const callbackUrl =
                transaction.type === "PAYIN" ? merchant.payin?.callbackUrl : merchant.payout?.callbackUrl;
            if (!callbackUrl) {
                logger.warn(
                    {
                        event: "callback.skip",
                        reason: "callback_url_missing",
                        merchantId: merchant.id,
                        transactionId: transaction.id,
                        orderId: transaction.orderId,
                        type: transaction.type
                    },
                    "[Callback] Skipped merchant callback"
                );
                return;
            }

            const eventType =
                options?.source === "ADMIN_RESEND"
                    ? "MERCHANT_WEBHOOK_RESEND"
                    : "MERCHANT_WEBHOOK_SENT";

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
                    callbackUrl,
                    payload
                },
                "[Callback] Sending merchant callback"
            );

            transaction.events.push({
                type: eventType,
                timestamp: getISTDate(),
                payload: {
                    source: options?.source,
                    webhookId: options?.webhookId,
                    callbackUrl,
                    status: transaction.status,
                    type: transaction.type,
                    reason: options?.reason,
                    actor: options?.actor,
                }
            });
            await transaction.save();

            axios
                .post(callbackUrl, payload, { timeout: 10000, headers })
                .then(response => {
                    logger.info(
                        {
                            event: "callback.response",
                            source: options?.source,
                            webhookId: options?.webhookId,
                            merchantId: merchant.id,
                            transactionId: transaction.id,
                            orderId: transaction.orderId,
                            status: response.status,
                            response: response.data
                        },
                        "[Callback] Merchant responded"
                    );
                })
                .catch(err => {
                    const response = axios.isAxiosError(err) ? err.response : undefined;
                    logger.warn(
                        {
                            event: "callback.failed",
                            source: options?.source,
                            webhookId: options?.webhookId,
                            merchantId: merchant.id,
                            transactionId: transaction.id,
                            orderId: transaction.orderId,
                            error: err.message,
                            status: response?.status,
                            response: response?.data
                        },
                        `[Callback] Failed for ${transaction.id}`
                    );
                });
        } catch (error: any) {
            logger.error(
                { error: error.message, transactionId: transaction?.id, source: options?.source },
                "[Callback] Failed to send merchant callback"
            );
        }
    }
}
