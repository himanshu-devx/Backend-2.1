import { redis } from "@/infra/redis-instance";
import { logger } from "@/infra/logger-instance";
import { WEBHOOK_RETRY_DEFAULTS } from "@/constants/resilience.constant";

const JOB_QUEUE_KEY = "core:job:queue";
const JOB_DELAYED_KEY = "core:job:delayed";
const JOB_DLQ_KEY = "core:job:dead";

export interface JobTask {
    id: string;
    type: string;
    payload: any;
    receivedAt: Date;
    attempt?: number;
    maxAttempts?: number;
    lastError?: string;
}

export class JobQueue {
    /**
     * Push a task to the Redis queue
     */
    static async enqueue(task: Omit<JobTask, "receivedAt" | "id"> & { id?: string }) {
        try {
            const fullTask: JobTask = {
                id: task.id || `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                ...task,
                receivedAt: new Date(),
                attempt: task.attempt ?? 0,
                maxAttempts: task.maxAttempts ?? WEBHOOK_RETRY_DEFAULTS.MAX_ATTEMPTS
            };
            await redis.lpush(JOB_QUEUE_KEY, JSON.stringify(fullTask));
            logger.info(
                {
                    jobId: fullTask.id,
                    jobType: fullTask.type,
                },
                "[JobQueue] Enqueued job"
            );
            return fullTask.id;
        } catch (error: any) {
            logger.error(`[JobQueue] Failed to enqueue: ${error.message}`);
            throw error;
        }
    }

    /**
     * Pull the next task from the queue (Blocking)
     */
    static async dequeue(timeout: number = 0): Promise<JobTask | null> {
        try {
            const delayed = await this.popDueDelayed();
            if (delayed) return delayed;

            const result = await redis.brpop(JOB_QUEUE_KEY, timeout);
            if (!result) return null;

            return JSON.parse(result[1]) as JobTask;
        } catch (error: any) {
            logger.error(`[JobQueue] Error dequeuing: ${error.message}`);
            return null;
        }
    }

    static async retry(task: JobTask, errorMsg: string) {
        const attempt = (task.attempt ?? 0) + 1;
        const maxAttempts = task.maxAttempts ?? WEBHOOK_RETRY_DEFAULTS.MAX_ATTEMPTS;
        const updated: JobTask = {
            ...task,
            attempt,
            maxAttempts,
            lastError: errorMsg,
        };

        if (attempt > maxAttempts) {
            await redis.lpush(JOB_DLQ_KEY, JSON.stringify(updated));
            logger.error(
                { jobId: task.id, jobType: task.type, attempts: attempt },
                `[JobQueue] Job moved to DLQ after ${maxAttempts} attempts`
            );
            return;
        }

        const delay = Math.min(
            WEBHOOK_RETRY_DEFAULTS.MAX_DELAY_MS,
            WEBHOOK_RETRY_DEFAULTS.BASE_DELAY_MS * Math.pow(2, attempt - 1)
        );
        const runAt = Date.now() + delay;

        await redis.zadd(JOB_DELAYED_KEY, runAt, JSON.stringify(updated));
        logger.warn(
            { jobId: task.id, jobType: task.type, attempt, delay },
            `[JobQueue] Retrying job in ${delay}ms`
        );
    }

    private static async popDueDelayed(): Promise<JobTask | null> {
        const now = Date.now();
        const items = await redis.zrangebyscore(JOB_DELAYED_KEY, 0, now, "LIMIT", 0, 1);
        if (!items || items.length === 0) return null;

        const item = items[0];
        await redis.zrem(JOB_DELAYED_KEY, item);
        return JSON.parse(item) as JobTask;
    }

    /**
     * Get queue length
     */
    static async getLength(): Promise<number> {
        return redis.llen(JOB_QUEUE_KEY);
    }
}
