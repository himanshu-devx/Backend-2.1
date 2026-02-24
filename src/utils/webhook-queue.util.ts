import { redis } from "@/infra/redis-instance";
import { logger } from "@/infra/logger-instance";
import { WEBHOOK_RETRY_DEFAULTS } from "@/constants/resilience.constant";

const WEBHOOK_QUEUE_KEY = "webhook:queue";
const WEBHOOK_DELAYED_KEY = "webhook:queue:delayed";
const WEBHOOK_DLQ_KEY = "webhook:queue:dead";

export interface WebhookTask {
    type: "PAYIN" | "PAYOUT" | "COMMON";
    providerId: string;
    legalEntityId: string;
    rawBody: string;
    webhookId?: string;
    receivedAt: Date;
    attempt?: number;
    maxAttempts?: number;
    lastError?: string;
}

export class WebhookQueue {
    /**
     * Push a webhook task to the Redis queue
     */
    static async enqueue(task: Omit<WebhookTask, "receivedAt">) {
        try {
            const fullTask: WebhookTask = {
                ...task,
                receivedAt: new Date(),
                attempt: task.attempt ?? 0,
                maxAttempts: task.maxAttempts ?? WEBHOOK_RETRY_DEFAULTS.MAX_ATTEMPTS
            };
            await redis.lpush(WEBHOOK_QUEUE_KEY, JSON.stringify(fullTask));
            logger.info(
                {
                    event: "webhook.enqueue",
                    component: "queue",
                    type: task.type,
                    providerId: task.providerId,
                    legalEntityId: task.legalEntityId,
                    webhookId: task.webhookId,
                    rawBodyLength: task.rawBody?.length || 0
                },
                "[WebhookQueue] Enqueued webhook"
            );
        } catch (error: any) {
            logger.error(`[WebhookQueue] Failed to enqueue: ${error.message}`);
        }
    }

    /**
     * Pull the next webhook task from the queue (Blocking)
     */
    static async dequeue(timeout: number = 0): Promise<WebhookTask | null> {
        try {
            const delayed = await this.popDueDelayed();
            if (delayed) return delayed;

            const result = await redis.brpop(WEBHOOK_QUEUE_KEY, timeout);
            if (!result) return null;

            return JSON.parse(result[1]) as WebhookTask;
        } catch (error: any) {
            logger.error(`[WebhookQueue] Error dequeuing: ${error.message}`);
            return null;
        }
    }

    static async retry(task: WebhookTask, errorMsg: string) {
        const attempt = (task.attempt ?? 0) + 1;
        const maxAttempts = task.maxAttempts ?? WEBHOOK_RETRY_DEFAULTS.MAX_ATTEMPTS;
        const updated: WebhookTask = {
            ...task,
            attempt,
            maxAttempts,
            lastError: errorMsg,
        };

        if (attempt > maxAttempts) {
            await redis.lpush(WEBHOOK_DLQ_KEY, JSON.stringify(updated));
            logger.error(
                {
                    event: "webhook.dlq",
                    component: "queue",
                    type: task.type,
                    providerId: task.providerId,
                    legalEntityId: task.legalEntityId,
                    webhookId: task.webhookId,
                    attempts: attempt,
                },
                `[WebhookQueue] Task moved to DLQ after ${attempt - 1} retries`
            );
            return;
        }

        const delay = Math.min(
            WEBHOOK_RETRY_DEFAULTS.MAX_DELAY_MS,
            WEBHOOK_RETRY_DEFAULTS.BASE_DELAY_MS * Math.pow(2, attempt - 1)
        );
        const runAt = Date.now() + delay;

        await redis.zadd(WEBHOOK_DELAYED_KEY, runAt, JSON.stringify(updated));
        logger.warn(
            {
                event: "webhook.retry",
                component: "queue",
                type: task.type,
                providerId: task.providerId,
                legalEntityId: task.legalEntityId,
                webhookId: task.webhookId,
                attempt,
                maxAttempts,
                delay,
            },
            `[WebhookQueue] Retrying task in ${delay}ms (attempt ${attempt}/${maxAttempts})`
        );
    }

    private static async popDueDelayed(): Promise<WebhookTask | null> {
        const now = Date.now();
        const items = await redis.zrangebyscore(WEBHOOK_DELAYED_KEY, 0, now, "LIMIT", 0, 1);
        if (!items || items.length === 0) return null;

        const item = items[0];
        await redis.zrem(WEBHOOK_DELAYED_KEY, item);
        return JSON.parse(item) as WebhookTask;
    }

    /**
     * Get queue length
     */
    static async getLength(): Promise<number> {
        return redis.llen(WEBHOOK_QUEUE_KEY);
    }
}
