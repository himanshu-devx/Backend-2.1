import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { ProviderClient } from "@/services/provider-config/provider-client.service";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { MerchantCallbackService } from "@/services/payment/merchant-callback.service";
import { TransactionMonitorService } from "@/services/payment/transaction-monitor.service";

export class WebhookWorkflow {
    async execute(
        type: "PAYIN" | "PAYOUT" | "COMMON",
        providerId: string,
        legalEntityId: string,
        rawBody: string,
        webhookId?: string
    ) {
        logger.info(
            {
                event: "webhook.process",
                source: "WEBHOOK",
                type,
                providerId,
                legalEntityId,
                webhookId,
                rawBodyLength: rawBody.length
            },
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
                event: "webhook.parsed",
                source: "WEBHOOK",
                type,
                providerId,
                legalEntityId,
                webhookId,
                transactionId: result.transactionId,
                providerTransactionId: result.providerTransactionId,
                status: result.status
            },
            "[WebhookWorkflow] Parsed webhook"
        );

        if (!result.transactionId && !result.providerTransactionId) {
            throw new Error("No transaction reference in webhook");
        }

        // 3. Persistent Record & Lock
        let transaction = result.transactionId
            ? await TransactionModel.findOne({ id: result.transactionId })
            : null;
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

        const resolvedType =
            type === "COMMON"
                ? (transaction.type as "PAYIN" | "PAYOUT")
                : type;

        if (transaction.status !== TransactionStatus.PENDING) {
            transaction.events.push({
                type: "WEBHOOK_DUPLICATE",
                timestamp: getISTDate(),
                payload: { rawBody }
            });
            await transaction.save();
            if (resolvedType === "PAYOUT") {
                await TransactionMonitorService.stopPayoutPolling(transaction.id);
            }
            logger.info(
                {
                    event: "webhook.duplicate",
                    source: "WEBHOOK",
                    webhookId,
                    transactionId: transaction.id,
                    orderId: transaction.orderId,
                    status: transaction.status
                },
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
                transaction.events.push({
                    type: "WEBHOOK_SUCCESS",
                    timestamp: getISTDate(),
                    payload: { rawBody }
                });

                // Execute Financial Transition
                if (resolvedType === "PAYIN") {
                    await PaymentLedgerService.processPayinCredit(transaction);
                } else if (resolvedType === "PAYOUT") {
                    await PaymentLedgerService.commitPayout(transaction);
                }
            } else if (result.status === "FAILED") {
                transaction.status = TransactionStatus.FAILED;
                transaction.error = result.message || "Provider reported failure";
                transaction.events.push({
                    type: "WEBHOOK_FAILED",
                    timestamp: getISTDate(),
                    payload: { rawBody }
                });

                if (resolvedType === "PAYOUT") {
                    await PaymentLedgerService.voidPayout(transaction);
                }
            }

            await transaction.save();

            // 5. Outbound Notification
            MerchantCallbackService.notify(transaction, { source: "WEBHOOK", webhookId });
            if (resolvedType === "PAYOUT") {
                await TransactionMonitorService.stopPayoutPolling(transaction.id);
            }

            logger.info(
                {
                    event: "webhook.updated",
                    source: "WEBHOOK",
                    webhookId,
                    transactionId: transaction.id,
                    orderId: transaction.orderId,
                    status: transaction.status
                },
                "[WebhookWorkflow] Transaction updated from webhook"
            );

            return { transaction, alreadyProcessed: false };

        } catch (error: any) {
            logger.error(
                {
                    event: "webhook.error",
                    source: "WEBHOOK",
                    webhookId,
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

}
