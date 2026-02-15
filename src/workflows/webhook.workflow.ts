import { TransactionModel, TransactionStatus, TransactionDocument } from "@/models/transaction.model";
import { ProviderClient } from "@/services/provider-config/provider-client.service";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import axios from "axios";
import crypto from "crypto";
import { decryptSecret } from "@/utils/secret.util";
import { toDisplayAmount } from "@/utils/money.util";

export class WebhookWorkflow {
    async execute(
        type: "PAYIN" | "PAYOUT" | "COMMON",
        providerId: string,
        legalEntityId: string,
        rawBody: string
    ) {
        logger.info(
            { type, providerId, legalEntityId, rawBodyLength: rawBody.length },
            "[WebhookWorkflow] Processing webhook"
        );

        const providerType = await CacheService.getProviderType(providerId);
        if (providerType === "GATEWAY" && !legalEntityId) {
            throw new Error("legalEntityId is required for gateway webhook");
        }

        if (providerType === "GATEWAY") {
            const ple = await CacheService.getChannel(providerId, legalEntityId);
            if (!ple) throw new Error("Channel not found");
        }

        // 2. Parse & Verify (State Transition Check)
        const provider = await ProviderClient.getProviderForRouting(
            providerId,
            legalEntityId
        );
        const result = await provider.handleWebhook({ rawBody }, type);

        logger.info(
            {
                type,
                providerId,
                legalEntityId,
                transactionId: result.transactionId,
                providerTransactionId: result.providerTransactionId,
                status: result.status
            },
            "[WebhookWorkflow] Parsed webhook"
        );

        if (!result.transactionId) throw new Error("No transactionId in webhook");

        // 3. Persistent Record & Lock
        let transaction = await TransactionModel.findOne({ id: result.transactionId });
        if (!transaction) {
            const refCandidates = [
                result.transactionId,
                result.providerTransactionId
            ].filter(Boolean) as string[];

            for (const ref of refCandidates) {
                transaction = await TransactionModel.findOne({ providerRef: ref, providerId });
                if (transaction) {
                    logger.info(
                        { transactionId: transaction.id, providerId, providerRef: ref },
                        "[WebhookWorkflow] Transaction matched by providerRef"
                    );
                    break;
                }
            }
        }
        if (!transaction) {
            logger.error(
                { transactionId: result.transactionId, providerId, legalEntityId },
                "[WebhookWorkflow] Transaction not found"
            );
            throw new Error(`Txn ${result.transactionId} not found`);
        }

        if (transaction.status !== TransactionStatus.PENDING) {
            transaction.events.push({
                type: "WEBHOOK_DUPLICATE",
                timestamp: getISTDate(),
                payload: result
            });
            await transaction.save();
            logger.info(
                { transactionId: transaction.id, orderId: transaction.orderId, status: transaction.status },
                "[WebhookWorkflow] Transaction already processed"
            );
            return { transaction, alreadyProcessed: true };
        }

        // 4. State Update
        transaction.providerRef = result.providerTransactionId || transaction.providerRef;
        transaction.utr = result.utr || transaction.utr;

        try {
            if (result.status === "SUCCESS") {
                transaction.status = TransactionStatus.SUCCESS;
                transaction.events.push({ type: "WEBHOOK_SUCCESS", timestamp: getISTDate(), payload: result });

                // Execute Financial Transition
                if (type === "PAYIN") {
                    await PaymentLedgerService.processPayinCredit(transaction);
                } else {
                    await PaymentLedgerService.commitPayout(transaction);
                }
            } else if (result.status === "FAILED") {
                transaction.status = TransactionStatus.FAILED;
                transaction.error = result.message || "Provider reported failure";
                transaction.events.push({ type: "WEBHOOK_FAILED", timestamp: getISTDate(), payload: result });

                if (type === "PAYOUT") {
                    await PaymentLedgerService.voidPayout(transaction);
                }
            }

            await transaction.save();

            // 5. Outbound Notification
            this.notifyMerchant(transaction);

            logger.info(
                { transactionId: transaction.id, orderId: transaction.orderId, status: transaction.status },
                "[WebhookWorkflow] Transaction updated from webhook"
            );

            return { transaction, alreadyProcessed: false };

        } catch (error: any) {
            logger.error(
                {
                    transactionId: transaction.id,
                    orderId: transaction.orderId,
                    error: error.message
                },
                "[WebhookWorkflow] Critical error"
            );
            // We don't mark as FAILED here if it's a code error (e.g. ledger down), 
            // so we can retry the webhook.
            throw error;
        }
    }

    private async notifyMerchant(transaction: TransactionDocument) {
        if (!transaction.merchantId) return;
        const merchant = await CacheService.getMerchant(transaction.merchantId);
        if (!merchant) return;

        const callbackUrl = transaction.type === "PAYIN" ? merchant.payin.callbackUrl : merchant.payout.callbackUrl;
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
                // Legacy hash in body (amount|currency|orderId|secret)
                const currency = transaction.currency || "INR";
                const legacyString = `${basePayload.amount}|${currency}|${transaction.orderId}|${apiSecret}`;
                const legacyHash = crypto.createHmac("sha256", apiSecret).update(legacyString).digest("hex");
                payload = { ...basePayload, currency, hash: legacyHash };

                // Signature header over raw body + timestamp
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

        axios.post(callbackUrl, payload, { timeout: 5000, headers }).catch(err => {
            logger.warn(`[Callback] Failed for ${transaction.id}: ${err.message}`);
        });
    }
}
