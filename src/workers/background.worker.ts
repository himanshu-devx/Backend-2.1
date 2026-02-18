import { JobQueue, JobTask } from "@/utils/job-queue.util";
import { WebhookQueue, WebhookTask } from "@/utils/webhook-queue.util";
import { logger } from "@/infra/logger-instance";
import { ProviderFeeSettlementService } from "@/services/provider-fee-settlement/provider-fee-settlement.service";
import { WebhookWorkflow } from "@/workflows/webhook.workflow";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { getISTDate } from "@/utils/date.util";
import { CacheService } from "@/services/common/cache.service";
import { StatusSyncWorkflow } from "@/workflows/status-sync.workflow";
import { PAYMENT_TIMEOUTS } from "@/constants/payment-timeouts.constant";
import { Metrics } from "@/infra/metrics";
import { TransactionOutboxService } from "@/services/payment/transaction-outbox.service";
import { OutboxService } from "@/services/common/outbox.service";
import { OUTBOX_TYPES } from "@/constants/outbox.constant";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { MerchantCallbackService } from "@/services/payment/merchant-callback.service";

export class BackgroundWorker {
    private static isRunning = true;
    private static webhookWorkflow = new WebhookWorkflow();

    static async start() {
        logger.info("[BackgroundWorker] Starting unified worker processes...");

        // Start parallel loops
        await Promise.all([
            this.startJobLoop(),
            this.startWebhookLoop(),
            this.startOutboxLoop()
        ]);
    }

    static stop() {
        this.isRunning = false;
        logger.info("[BackgroundWorker] Stopping unified worker processes...");
    }

    /**
     * Loop for generic JobQueue tasks (e.g., Settlements)
     */
    private static async startJobLoop() {
        logger.info("[BackgroundWorker] Job loop active");
        while (this.isRunning) {
            try {
                const task = await JobQueue.dequeue(5);
                if (!task) continue;

                await this.processJobTask(task);
            } catch (error: any) {
                logger.error({ error: error.message }, "[BackgroundWorker] Job loop error");
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    /**
     * Loop for WebhookQueue tasks (e.g., Payin/Payout completions)
     */
    private static async startWebhookLoop() {
        logger.info("[BackgroundWorker] Webhook loop active");
        while (this.isRunning) {
            try {
                const task = await WebhookQueue.dequeue(5);
                if (!task) continue;

                await this.processWebhookTask(task);
            } catch (error: any) {
                logger.error({ error: error.message }, "[BackgroundWorker] Webhook loop error");
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    private static async processJobTask(task: JobTask) {
        logger.info({ jobId: task.id, type: task.type }, "[BackgroundWorker] Processing Job");
        try {
            switch (task.type) {
                case "PROVIDER_FEE_SETTLEMENT":
                    await ProviderFeeSettlementService.processPLESettlement(
                        task.payload.pleId,
                        task.payload.targetDate
                    );
                    break;
                case "SETTLEMENT_VERIFICATION":
                    await ProviderFeeSettlementService.verifySettlements();
                    break;
                case "PAYIN_EXPIRE":
                    await this.processPayinExpire(task.payload);
                    break;
                case "PAYOUT_STATUS_POLL":
                    await this.processPayoutStatusPoll(task.payload);
                    break;
                default:
                    logger.warn({ type: task.type }, "[BackgroundWorker] Unknown job type");
            }
            await JobQueue.ack(task);
            logger.info({ jobId: task.id }, "[BackgroundWorker] Job completed");
        } catch (error: any) {
            logger.error({ jobId: task.id, error: error.message }, "[BackgroundWorker] Job failed");
            await JobQueue.retry(task, error.message);
        }
    }

    private static async processWebhookTask(task: WebhookTask) {
        logger.info({ type: task.type, providerId: task.providerId }, "[BackgroundWorker] Processing Webhook");
        try {
            await this.webhookWorkflow.execute(
                task.type,
                task.providerId,
                task.legalEntityId,
                task.rawBody
            );
            await WebhookQueue.ack(task);
            logger.info({ type: task.type }, "[BackgroundWorker] Webhook completed");
        } catch (error: any) {
            logger.error({ type: task.type, error: error.message }, "[BackgroundWorker] Webhook failed");
            await WebhookQueue.retry(task, error.message);
        }
    }

    /**
     * Loop for Outbox events (Ledger commits + Merchant callbacks)
     */
    private static async startOutboxLoop() {
        logger.info("[BackgroundWorker] Outbox loop active");
        while (this.isRunning) {
            try {
                const event = await OutboxService.claimNext();
                if (!event) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                await this.processOutboxEvent(event);
            } catch (error: any) {
                logger.error({ error: error.message }, "[BackgroundWorker] Outbox loop error");
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    private static async processOutboxEvent(event: any) {
        try {
            switch (event.type) {
                case OUTBOX_TYPES.LEDGER_PAYIN_CREDIT: {
                    const txn = await TransactionModel.findOne({ id: event.payload.transactionId });
                    if (txn) await PaymentLedgerService.processPayinCredit(txn);
                    break;
                }
                case OUTBOX_TYPES.LEDGER_PAYOUT_COMMIT: {
                    const txn = await TransactionModel.findOne({ id: event.payload.transactionId });
                    if (txn) await PaymentLedgerService.commitPayout(txn);
                    break;
                }
                case OUTBOX_TYPES.LEDGER_PAYOUT_VOID: {
                    const txn = await TransactionModel.findOne({ id: event.payload.transactionId });
                    if (txn) await PaymentLedgerService.voidPayout(txn);
                    break;
                }
                case OUTBOX_TYPES.MERCHANT_CALLBACK: {
                    const txn = await TransactionModel.findOne({ id: event.payload.transactionId });
                    if (txn) await MerchantCallbackService.notify(txn);
                    break;
                }
                default:
                    logger.warn({ type: event.type }, "[BackgroundWorker] Unknown outbox type");
            }
            await OutboxService.markSuccess(event);
        } catch (error: any) {
            logger.error(
                { type: event.type, error: error.message, attempts: event.attempts },
                "[BackgroundWorker] Outbox event failed"
            );
            await OutboxService.markFailed(event, error.message);
        }
    }

    private static async processPayinExpire(payload: any) {
        const transactionId = payload?.transactionId as string | undefined;
        if (!transactionId) return;

        const transaction = await TransactionModel.findOne({ id: transactionId });
        if (!transaction) return;
        if (transaction.type !== "PAYIN") return;
        if (transaction.status !== TransactionStatus.PENDING && transaction.status !== TransactionStatus.PROCESSING) {
            return;
        }

        transaction.status = TransactionStatus.EXPIRED;
        transaction.error = "Webhook not received within expiry window";
        transaction.events.push({
            type: "PAYIN_EXPIRED",
            timestamp: getISTDate(),
            payload: { reason: "WEBHOOK_TIMEOUT" }
        });
        await transaction.save();
        await CacheService.setTransactionCache(transaction);
        await TransactionOutboxService.enqueueMerchantCallback(transaction);
        Metrics.payinExpired("WEBHOOK_TIMEOUT");
        logger.info(
            { transactionId: transaction.id, orderId: transaction.orderId, metric: "payin_expired" },
            "[BackgroundWorker] Payin expired"
        );
    }

    private static async processPayoutStatusPoll(payload: any) {
        const transactionId = payload?.transactionId as string | undefined;
        const merchantId = payload?.merchantId as string | undefined;
        const orderId = payload?.orderId as string | undefined;
        const pollCount = Number(payload?.pollCount || 1);
        if (!transactionId || !merchantId || !orderId) return;

        const transaction = await TransactionModel.findOne({ id: transactionId });
        if (!transaction) return;
        if (transaction.type !== "PAYOUT") return;
        if (transaction.status !== TransactionStatus.PENDING && transaction.status !== TransactionStatus.PROCESSING) {
            return;
        }

        const workflow = new StatusSyncWorkflow();
        await workflow.execute(merchantId, orderId);

        const refreshed = await TransactionModel.findOne({ id: transactionId });
        if (!refreshed) return;
        if (refreshed.status !== TransactionStatus.PENDING && refreshed.status !== TransactionStatus.PROCESSING) {
            await CacheService.setTransactionCache(refreshed);
            Metrics.payoutPoll(
                refreshed.status === TransactionStatus.SUCCESS
                    ? "success"
                    : refreshed.status === TransactionStatus.FAILED
                        ? "failed"
                        : "terminal"
            );
            logger.info(
                {
                    transactionId,
                    orderId,
                    status: refreshed.status,
                    metric: "payout_status_poll"
                },
                "[BackgroundWorker] Payout status resolved"
            );
            return;
        }

        Metrics.payoutPoll("pending");
        if (pollCount < PAYMENT_TIMEOUTS.PAYOUT_STATUS_MAX_POLLS) {
            await JobQueue.enqueueDelayed(
                {
                    id: `payout_poll_${transactionId}_${pollCount + 1}`,
                    type: "PAYOUT_STATUS_POLL",
                    payload: {
                        transactionId,
                        merchantId,
                        orderId,
                        pollCount: pollCount + 1,
                    }
                },
                PAYMENT_TIMEOUTS.PAYOUT_STATUS_POLL_INTERVAL_MS
            );
        }
    }
}
