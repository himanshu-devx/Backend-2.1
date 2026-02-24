import { JobQueue, JobTask } from "@/utils/job-queue.util";
import { WebhookQueue, WebhookTask } from "@/utils/webhook-queue.util";
import { logger } from "@/infra/logger-instance";
import { ProviderFeeSettlementService } from "@/services/provider-fee-settlement/provider-fee-settlement.service";
import { WebhookWorkflow } from "@/workflows/webhook.workflow";
import { TransactionMonitorService } from "@/services/payment/transaction-monitor.service";
import { runWithLogContext } from "@/infra/log-context";

export class BackgroundWorker {
    private static isRunning = true;
    private static webhookWorkflow = new WebhookWorkflow();

    static async start() {
        logger.info("[BackgroundWorker] Starting unified worker processes...");

        // Start parallel loops
        await Promise.all([
            this.startJobLoop(),
            this.startWebhookLoop()
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
        await runWithLogContext(
            {
                component: "worker",
                jobId: task.id,
                jobType: task.type,
                jobAttempt: task.attempt,
            },
            async () => {
                logger.info(
                    {
                        event: "job.process.start",
                        component: "worker",
                        jobId: task.id,
                        type: task.type,
                    },
                    "[BackgroundWorker] Processing Job"
                );
                try {
                    switch (task.type) {
                        case "PROVIDER_FEE_SETTLEMENT":
                            await ProviderFeeSettlementService.processPLESettlement(
                                task.payload.pleId,
                                task.payload.targetDate
                            );
                            break;
                        case "PAYIN_AUTO_EXPIRE":
                            await TransactionMonitorService.processPayinAutoExpire(
                                task.payload.transactionId
                            );
                            break;
                        case "PAYOUT_STATUS_POLL":
                            await TransactionMonitorService.processPayoutStatusPoll(
                                task.payload
                            );
                            break;
                        case "SETTLEMENT_VERIFICATION":
                            await ProviderFeeSettlementService.verifySettlements();
                            break;
                        default:
                            logger.warn({ type: task.type }, "[BackgroundWorker] Unknown job type");
                    }
                    logger.info(
                        {
                            event: "job.processed",
                            component: "worker",
                            jobId: task.id,
                            type: task.type,
                        },
                        "[BackgroundWorker] Job completed"
                    );
                } catch (error: any) {
                    logger.error(
                        {
                            event: "job.failed",
                            component: "worker",
                            jobId: task.id,
                            type: task.type,
                            error: error.message,
                        },
                        "[BackgroundWorker] Job failed"
                    );
                    await JobQueue.retry(task, error.message);
                }
            }
        );
    }

    private static async processWebhookTask(task: WebhookTask) {
        await runWithLogContext(
            {
                component: "worker",
                jobType: "WEBHOOK",
                providerId: task.providerId,
                legalEntityId: task.legalEntityId,
                source: "WEBHOOK",
                webhookId: task.webhookId,
            },
            async () => {
                logger.info(
                    {
                        event: "webhook.process.start",
                        component: "worker",
                        type: task.type,
                        providerId: task.providerId,
                        legalEntityId: task.legalEntityId,
                        webhookId: task.webhookId,
                        attempt: task.attempt,
                        receivedAt: task.receivedAt,
                    },
                    "[BackgroundWorker] Processing Webhook"
                );
                try {
                    await this.webhookWorkflow.execute(
                        task.type,
                        task.providerId,
                        task.legalEntityId,
                        task.rawBody,
                        task.webhookId
                    );
                    logger.info(
                        {
                            event: "webhook.processed",
                            component: "worker",
                            type: task.type,
                            providerId: task.providerId,
                            legalEntityId: task.legalEntityId,
                            webhookId: task.webhookId,
                        },
                        "[BackgroundWorker] Webhook completed"
                    );
                } catch (error: any) {
                    logger.error(
                        {
                            event: "webhook.failed",
                            component: "worker",
                            type: task.type,
                            providerId: task.providerId,
                            legalEntityId: task.legalEntityId,
                            webhookId: task.webhookId,
                            error: error.message,
                        },
                        "[BackgroundWorker] Webhook failed"
                    );
                    await WebhookQueue.retry(task, error.message);
                }
            }
        );
    }
}
