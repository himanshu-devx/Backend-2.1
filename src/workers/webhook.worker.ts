import { WebhookQueue } from "@/utils/webhook-queue.util";
import { WebhookWorkflow } from "@/workflows/webhook.workflow";
import { logger } from "@/infra/logger-instance";
import { bootstrap } from "@/bootstrap";

async function startWorker() {
    logger.info("[WebhookWorker] Initializing...");

    // Ensure DB/Redis are connected
    try {
        await bootstrap();
        logger.info("[WebhookWorker] Bootstrap successful. Listening for tasks...");
    } catch (err: any) {
        logger.error(`[WebhookWorker] Bootstrap failed: ${err.message}`);
        process.exit(1);
    }

    const workflow = new WebhookWorkflow();

    while (true) {
        try {
            // Block until a task is available
            const task = await WebhookQueue.dequeue(0);

            if (!task) continue;

            logger.info(
                {
                    type: task.type,
                    providerId: task.providerId,
                    legalEntityId: task.legalEntityId
                },
                "[WebhookWorker] Processing webhook"
            );

            try {
                // Execute Workflow with data directly from Queue
                const result = await workflow.execute(
                    task.type,
                    task.providerId,
                    task.legalEntityId,
                    task.rawBody
                );

                logger.info(
                    {
                        type: task.type,
                        providerId: task.providerId,
                        legalEntityId: task.legalEntityId,
                        transactionId: result.transaction.id,
                        orderId: result.transaction.orderId
                    },
                    "[WebhookWorker] Webhook processed"
                );

            } catch (workflowError: any) {
                logger.error(
                    {
                        type: task.type,
                        providerId: task.providerId,
                        legalEntityId: task.legalEntityId,
                        error: workflowError.message
                    },
                    "[WebhookWorker] Workflow error"
                );
                await WebhookQueue.retry(task, workflowError.message || "Workflow error");
            }

        } catch (err: any) {
            logger.error(`[WebhookWorker] Unexpected Loop Error: ${err.message}`);
            // Sleep briefly to prevent tight failure loop
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Start the worker if this file is run directly
const isMain = (() => {
    if (!process.argv[1]) return false;
    const entryUrl = new URL(`file://${process.argv[1]}`).href;
    return entryUrl === import.meta.url;
})();

if (isMain) {
    startWorker();
}

export { startWorker };
