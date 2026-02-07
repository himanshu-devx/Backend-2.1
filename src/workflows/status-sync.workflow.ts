import { TransactionModel, TransactionStatus, TransactionDocument } from "@/models/transaction.model";
import { ProviderFactory } from "@/providers/provider-factory";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { NotFound } from "@/utils/error";

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

        const provider = ProviderFactory.getProvider(ple.id);

        logger.info(`[StatusSync] Syncing ${transaction.id} with ${ple.providerId}`);
        const result = await provider.checkStatus({
            transactionId: transaction.id,
            providerTransactionId: transaction.providerRef,
            type: transaction.type as 'PAYIN' | 'PAYOUT'
        });

        // 4. State Transition (Workflow Step)
        if (result.status && result.status !== transaction.status) {
            transaction.status = result.status as any;
            transaction.utr = result.utr || transaction.utr;
            transaction.events.push({
                type: "STATUS_SYNCED",
                timestamp: getISTDate(),
                payload: { old: transaction.status, new: result.status }
            });

            if (result.status === "SUCCESS") {
                if (transaction.type === "PAYIN") {
                    await PaymentLedgerService.processPayinCredit(transaction);
                } else {
                    await PaymentLedgerService.commitPayout(transaction);
                }
            } else if (result.status === "FAILED") {
                if (transaction.type === "PAYOUT") {
                    await PaymentLedgerService.rollbackPayout(transaction);
                }
            }

            await transaction.save();
        }

        return transaction;
    }
}
