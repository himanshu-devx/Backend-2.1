import { TransactionModel, TransactionStatus, TransactionDocument } from "@/models/transaction.model";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { MerchantCallbackService } from "@/services/payment/merchant-callback.service";
import { TransactionMonitorService } from "@/services/payment/transaction-monitor.service";
import { NotFound } from "@/utils/error";
import { ProviderClient } from "@/services/provider-config/provider-client.service";

export class StatusSyncWorkflow {
    async execute(merchantId: string, orderId: string): Promise<TransactionDocument> {
        // 1. Resolve Transaction
        const transaction = await TransactionModel.findOne({ orderId, merchantId });
        if (!transaction) throw NotFound("Transaction not found");

        // 2. If already success/failed, just return (or optionally re-verify)
        if (transaction.status !== TransactionStatus.PENDING && transaction.status !== TransactionStatus.PROCESSING) {
            return transaction;
        }

        // 3. Call Provider Sync (Identity Check)
        if (!transaction.providerLegalEntityId) return transaction;

        const ple = await CacheService.getChannelById(transaction.providerLegalEntityId);
        if (!ple) return transaction;

        const provider = await ProviderClient.getProviderForRouting(
            ple.providerId,
            ple.legalEntityId
        );

        logger.info(
            {
                orderId: transaction.orderId,
                transactionId: transaction.id,
                providerId: ple.providerId,
                legalEntityId: ple.legalEntityId
            },
            "[StatusSync] Syncing status"
        );
        const statusRequest = {
            transactionId: transaction.id,
            providerTransactionId: transaction.providerRef,
        };

        const result = await ProviderClient.execute(ple.id, "status", () => {
            if (transaction.type === "PAYOUT") {
                return provider.checkPayoutStatus(statusRequest);
            }
            return provider.checkPayinStatus(statusRequest);
        });

        // 4. State Transition (Workflow Step)
        if (result.status && result.status !== transaction.status) {
            const oldStatus = transaction.status;
            transaction.status = result.status as any;
            transaction.utr = result.utr || transaction.utr;
            transaction.events.push({
                type: "STATUS_SYNCED",
                timestamp: getISTDate(),
                payload: { old: oldStatus, new: result.status }
            });
            logger.info(
                {
                    orderId: transaction.orderId,
                    transactionId: transaction.id,
                    status: transaction.status,
                    source: "STATUS_SYNC"
                },
                "[StatusSync] Status updated"
            );

            if (result.status === "SUCCESS") {
                if (transaction.type === "PAYIN") {
                    await PaymentLedgerService.processPayinCredit(transaction);
                } else {
                    await PaymentLedgerService.commitPayout(transaction);
                }
            } else if (result.status === "FAILED") {
                if (transaction.type === "PAYOUT") {
                    await PaymentLedgerService.voidPayout(transaction);
                }
            }

            await transaction.save();
            MerchantCallbackService.notify(transaction, { source: "STATUS_SYNC" });
            if (
                transaction.type === "PAYOUT" &&
                transaction.status !== TransactionStatus.PENDING &&
                transaction.status !== TransactionStatus.PROCESSING
            ) {
                await TransactionMonitorService.stopPayoutPolling(transaction.id);
            }
        }

        return transaction;
    }
}
