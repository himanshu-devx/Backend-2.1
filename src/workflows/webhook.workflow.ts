import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { ProviderClient } from "@/services/provider-config/provider-client.service";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { TransactionOutboxService } from "@/services/payment/transaction-outbox.service";
import { Metrics } from "@/infra/metrics";

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

        // Prevent duplicate in-flight processing
        const webhookLockRef = result.transactionId || result.providerTransactionId || rawBody.slice(0, 64);
        if (webhookLockRef) {
            const acquired = await CacheService.acquireWebhookLock(providerId, webhookLockRef);
            if (!acquired) {
                logger.info(
                    { transactionId: result.transactionId, providerId },
                    "[WebhookWorkflow] Duplicate webhook in-flight; skipping"
                );
                return { transaction: null, alreadyProcessed: true, skipped: true };
            }
        }

        // Fast path: if cached terminal (except EXPIRED), skip DB work
        const cachedById = await CacheService.getCachedTransactionById(result.transactionId);
        const cachedByRef = !cachedById && result.providerTransactionId
            ? await CacheService.getCachedTransactionByProviderRef(providerId, result.providerTransactionId)
            : null;
        const cachedTxn = cachedById || cachedByRef;
        if (
            cachedTxn &&
            cachedTxn.status !== TransactionStatus.PENDING &&
            cachedTxn.status !== TransactionStatus.PROCESSING &&
            cachedTxn.status !== TransactionStatus.EXPIRED
        ) {
            logger.info(
                { transactionId: cachedTxn.id, status: cachedTxn.status },
                "[WebhookWorkflow] Cached terminal transaction; skipping DB"
            );
            return { transaction: cachedTxn, alreadyProcessed: true, cached: true };
        }

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

        const createdAtMs = transaction.createdAt ? new Date(transaction.createdAt).getTime() : Date.now();
        const lagMs = Math.max(0, Date.now() - createdAtMs);
        Metrics.webhookLag(type, lagMs);

        const isProcessable =
            transaction.status === TransactionStatus.PENDING ||
            transaction.status === TransactionStatus.PROCESSING ||
            transaction.status === TransactionStatus.EXPIRED;

        if (!isProcessable) {
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
            await CacheService.setTransactionCache(transaction);
            return { transaction, alreadyProcessed: true };
        }

        // 4. State Update
        if (transaction.status === TransactionStatus.EXPIRED) {
            transaction.events.push({
                type: "WEBHOOK_LATE",
                timestamp: getISTDate(),
                payload: { previousStatus: TransactionStatus.EXPIRED }
            });
            logger.info(
                { transactionId: transaction.id, orderId: transaction.orderId },
                "[WebhookWorkflow] Late webhook received after expiry"
            );
        }

        transaction.providerRef = result.providerTransactionId || transaction.providerRef;
        transaction.utr = result.utr || transaction.utr;

        try {
            if (result.status === "SUCCESS") {
                transaction.status = TransactionStatus.SUCCESS;
                transaction.error = undefined;
                transaction.events.push({ type: "WEBHOOK_SUCCESS", timestamp: getISTDate(), payload: result });

            } else if (result.status === "FAILED") {
                transaction.status = TransactionStatus.FAILED;
                transaction.error = result.message || "Provider reported failure";
                transaction.events.push({ type: "WEBHOOK_FAILED", timestamp: getISTDate(), payload: result });
            }

            await transaction.save();
            await CacheService.setTransactionCache(transaction);

            // 5. Outbox Events (Ledger + Callback)
            await TransactionOutboxService.enqueueLedgerAction(transaction);
            await TransactionOutboxService.enqueueMerchantCallback(transaction);

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

}
