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

            logger.info(`[WebhookWorker] Processing ${task.type} for ${task.providerId}...`);

            try {
                // Execute Workflow with data directly from Queue
                const result = await workflow.execute(
                    task.type,
                    task.providerId,
                    task.legalEntityId,
                    task.payload
                );

                logger.info(`[WebhookWorker] Successfully processed ${task.type} (Txn: ${result.transaction.id})`);

            } catch (workflowError: any) {
                logger.error(`[WebhookWorker] Workflow Error: ${workflowError.message}`);
                // Since we don't have a DB log, we rely on Redis retries or dead-letter queues in a real system.
                // For now, we just log the error.
            }

        } catch (err: any) {
            logger.error(`[WebhookWorker] Unexpected Loop Error: ${err.message}`);
            // Sleep briefly to prevent tight failure loop
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Start the worker if this file is run directly
const isMain = import.meta.path === process.argv[1] || require.main === module;

if (isMain) {
    startWorker();
}

export { startWorker };
