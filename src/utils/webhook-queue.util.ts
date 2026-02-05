import { redis } from "@/infra/redis-instance";
import { logger } from "@/infra/logger-instance";

const WEBHOOK_QUEUE_KEY = "webhook:queue";

export interface WebhookTask {
    type: "PAYIN" | "PAYOUT";
    providerId: string;
    legalEntityId: string;
    payload: any;
    receivedAt: Date;
}

export class WebhookQueue {
    /**
     * Push a webhook task to the Redis queue
     */
    static async enqueue(task: Omit<WebhookTask, "receivedAt">) {
        try {
            const fullTask: WebhookTask = {
                ...task,
                receivedAt: new Date()
            };
            await redis.lpush(WEBHOOK_QUEUE_KEY, JSON.stringify(fullTask));
            logger.info(`[WebhookQueue] Enqueued ${task.type} for ${task.providerId}`);
        } catch (error: any) {
            logger.error(`[WebhookQueue] Failed to enqueue: ${error.message}`);
        }
    }

    /**
     * Pull the next webhook task from the queue (Blocking)
     */
    static async dequeue(timeout: number = 0): Promise<WebhookTask | null> {
        try {
            const result = await redis.brpop(WEBHOOK_QUEUE_KEY, timeout);
            if (!result) return null;

            return JSON.parse(result[1]) as WebhookTask;
        } catch (error: any) {
            logger.error(`[WebhookQueue] Error dequeuing: ${error.message}`);
            return null;
        }
    }

    /**
     * Get queue length
     */
    static async getLength(): Promise<number> {
        return redis.llen(WEBHOOK_QUEUE_KEY);
    }
}
