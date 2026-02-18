import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { TransactionOutboxService } from "@/services/payment/transaction-outbox.service";
import { NotFound } from "@/utils/error";
import { ProviderClient } from "@/services/provider-config/provider-client.service";

export class StatusSyncWorkflow {
    async execute(merchantId: string, orderId: string): Promise<any> {
        const isTerminal = (status?: TransactionStatus) =>
            status && status !== TransactionStatus.PENDING && status !== TransactionStatus.PROCESSING;

        // 0. Fast path: serve from cache when terminal
        const cached = await CacheService.getCachedTransactionByOrder(merchantId, orderId);
        if (cached && isTerminal(cached.status as TransactionStatus)) {
            return cached;
        }

        // If cached and still pending, avoid provider stampede
        let syncLockAcquired = false;
        if (cached && !isTerminal(cached.status as TransactionStatus)) {
            syncLockAcquired = await CacheService.acquireStatusSyncLock(merchantId, orderId);
            if (!syncLockAcquired) {
                return cached;
            }
        }

        // 1. Resolve Transaction (DB fallback)
        const transaction = await TransactionModel.findOne({ orderId, merchantId });
        if (!transaction) throw NotFound("Transaction not found");
        await CacheService.setTransactionCache(transaction);

        // 2. If already success/failed, just return (or optionally re-verify)
        if (isTerminal(transaction.status)) {
            await CacheService.setTransactionCache(transaction);
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

        // Avoid provider stampede across nodes
        if (!syncLockAcquired) {
            syncLockAcquired = await CacheService.acquireStatusSyncLock(merchantId, orderId);
            if (!syncLockAcquired) {
                return transaction;
            }
        }

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
            transaction.status = result.status as any;
            transaction.utr = result.utr || transaction.utr;
            transaction.events.push({
                type: "STATUS_SYNCED",
                timestamp: getISTDate(),
                payload: { old: transaction.status, new: result.status }
            });
            logger.info(
                {
                    orderId: transaction.orderId,
                    transactionId: transaction.id,
                    status: transaction.status
                },
                "[StatusSync] Status updated"
            );

            await transaction.save();
            await CacheService.setTransactionCache(transaction);

            await TransactionOutboxService.enqueueLedgerAction(transaction);
            await TransactionOutboxService.enqueueMerchantCallback(transaction);
        }

        await CacheService.setTransactionCache(transaction);
        return transaction;
    }
}
