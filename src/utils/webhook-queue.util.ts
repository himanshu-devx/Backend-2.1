import { redis } from "@/infra/redis-instance";
import { logger } from "@/infra/logger-instance";
import { WEBHOOK_RETRY_DEFAULTS } from "@/constants/resilience.constant";
import { ENV } from "@/config/env";

const WEBHOOK_QUEUE_KEY = "webhook:queue";
const WEBHOOK_DELAYED_KEY = "webhook:queue:delayed";
const WEBHOOK_DLQ_KEY = "webhook:queue:dead";
const WEBHOOK_STREAM_KEY = "webhook:stream";
const WEBHOOK_STREAM_GROUP = "webhook:group";
const WEBHOOK_STREAM_CONSUMER = `${ENV.SERVICE_NAME || "service"}-${process.pid}`;
const WEBHOOK_STREAM_IDLE_MS = 60000;
const USE_STREAMS = ENV.REDIS_USE_STREAMS;

export interface WebhookTask {
    type: "PAYIN" | "PAYOUT" | "COMMON";
    providerId: string;
    legalEntityId: string;
    rawBody: string;
    receivedAt: Date;
    attempt?: number;
    maxAttempts?: number;
    lastError?: string;
    streamId?: string;
}

export class WebhookQueue {
    private static async ensureStreamGroup() {
        try {
            await redis.xgroup("CREATE", WEBHOOK_STREAM_KEY, WEBHOOK_STREAM_GROUP, "0", "MKSTREAM");
        } catch (err: any) {
            if (!String(err?.message || "").includes("BUSYGROUP")) throw err;
        }
    }

    private static parseStreamEntry(entry: any): WebhookTask {
        const streamId = entry[0];
        const fields = entry[1] || [];
        const dataIndex = fields.indexOf("data");
        const raw = dataIndex >= 0 ? fields[dataIndex + 1] : null;
        const task = raw ? (JSON.parse(raw) as WebhookTask) : ({} as WebhookTask);
        task.streamId = streamId;
        return task;
    }

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
            if (USE_STREAMS) {
                await redis.xadd(WEBHOOK_STREAM_KEY, "*", "data", JSON.stringify(fullTask));
            } else {
                await redis.lpush(WEBHOOK_QUEUE_KEY, JSON.stringify(fullTask));
            }
            logger.info(
                {
                    type: task.type,
                    providerId: task.providerId,
                    legalEntityId: task.legalEntityId,
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

            if (USE_STREAMS) {
                await this.ensureStreamGroup();

                const claimed = await (redis as any).xautoclaim(
                    WEBHOOK_STREAM_KEY,
                    WEBHOOK_STREAM_GROUP,
                    WEBHOOK_STREAM_CONSUMER,
                    WEBHOOK_STREAM_IDLE_MS,
                    "0-0",
                    "COUNT",
                    1
                );
                if (claimed && claimed[1] && claimed[1].length > 0) {
                    return this.parseStreamEntry(claimed[1][0]);
                }

                const result = await redis.xreadgroup(
                    "GROUP",
                    WEBHOOK_STREAM_GROUP,
                    WEBHOOK_STREAM_CONSUMER,
                    "BLOCK",
                    timeout * 1000,
                    "COUNT",
                    1,
                    "STREAMS",
                    WEBHOOK_STREAM_KEY,
                    ">"
                );
                if (!result) return null;
                const entry = result[0][1][0];
                return this.parseStreamEntry(entry);
            }

            const result = await redis.brpop(WEBHOOK_QUEUE_KEY, timeout);
            if (!result) return null;
            return JSON.parse(result[1]) as WebhookTask;
        } catch (error: any) {
            logger.error(`[WebhookQueue] Error dequeuing: ${error.message}`);
            return null;
        }
    }

    static async ack(task: WebhookTask) {
        if (!USE_STREAMS) return;
        if (!task.streamId) return;
        try {
            await redis.xack(WEBHOOK_STREAM_KEY, WEBHOOK_STREAM_GROUP, task.streamId);
        } catch (error: any) {
            logger.error(`[WebhookQueue] Failed to ack: ${error.message}`);
        }
    }

    static async retry(task: WebhookTask, errorMsg: string) {
        if (USE_STREAMS && task.streamId) {
            await this.ack(task);
        }
        const attempt = (task.attempt ?? 0) + 1;
        const maxAttempts = task.maxAttempts ?? WEBHOOK_RETRY_DEFAULTS.MAX_ATTEMPTS;
        const updated: WebhookTask = {
            ...task,
            attempt,
            maxAttempts,
            lastError: errorMsg,
            streamId: undefined,
        };

        if (attempt > maxAttempts) {
            await redis.lpush(WEBHOOK_DLQ_KEY, JSON.stringify(updated));
            logger.error(`[WebhookQueue] Task moved to DLQ after ${attempt - 1} retries`);
            return;
        }

        const delay = Math.min(
            WEBHOOK_RETRY_DEFAULTS.MAX_DELAY_MS,
            WEBHOOK_RETRY_DEFAULTS.BASE_DELAY_MS * Math.pow(2, attempt - 1)
        );
        const runAt = Date.now() + delay;

        await redis.zadd(WEBHOOK_DELAYED_KEY, runAt, JSON.stringify(updated));
        logger.warn(`[WebhookQueue] Retrying task in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
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
        if (USE_STREAMS) {
            return redis.xlen(WEBHOOK_STREAM_KEY);
        }
        return redis.llen(WEBHOOK_QUEUE_KEY);
    }
}
