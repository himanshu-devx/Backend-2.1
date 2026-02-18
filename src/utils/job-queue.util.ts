import { redis } from "@/infra/redis-instance";
import { logger } from "@/infra/logger-instance";
import { WEBHOOK_RETRY_DEFAULTS } from "@/constants/resilience.constant";
import { ENV } from "@/config/env";

const JOB_QUEUE_KEY = "core:job:queue";
const JOB_DELAYED_KEY = "core:job:delayed";
const JOB_DLQ_KEY = "core:job:dead";
const JOB_STREAM_KEY = "core:job:stream";
const JOB_STREAM_GROUP = "core:job:group";
const JOB_STREAM_CONSUMER = `${ENV.SERVICE_NAME || "service"}-${process.pid}`;
const JOB_STREAM_IDLE_MS = 60000;
const USE_STREAMS = ENV.REDIS_USE_STREAMS;

export interface JobTask {
    id: string;
    type: string;
    payload: any;
    receivedAt: Date;
    attempt?: number;
    maxAttempts?: number;
    lastError?: string;
    streamId?: string;
}

export class JobQueue {
    private static async ensureStreamGroup() {
        try {
            await redis.xgroup("CREATE", JOB_STREAM_KEY, JOB_STREAM_GROUP, "0", "MKSTREAM");
        } catch (err: any) {
            if (!String(err?.message || "").includes("BUSYGROUP")) throw err;
        }
    }

    private static parseStreamEntry(entry: any): JobTask {
        const streamId = entry[0];
        const fields = entry[1] || [];
        const dataIndex = fields.indexOf("data");
        const raw = dataIndex >= 0 ? fields[dataIndex + 1] : null;
        const task = raw ? (JSON.parse(raw) as JobTask) : ({} as JobTask);
        task.streamId = streamId;
        return task;
    }

    private static buildTask(
        task: Omit<JobTask, "receivedAt" | "id"> & { id?: string }
    ): JobTask {
        return {
            id: task.id || `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ...task,
            receivedAt: new Date(),
            attempt: task.attempt ?? 0,
            maxAttempts: task.maxAttempts ?? WEBHOOK_RETRY_DEFAULTS.MAX_ATTEMPTS
        };
    }

    /**
     * Push a task to the Redis queue
     */
    static async enqueue(task: Omit<JobTask, "receivedAt" | "id"> & { id?: string }) {
        try {
            const fullTask = this.buildTask(task);
            if (USE_STREAMS) {
                await redis.xadd(JOB_STREAM_KEY, "*", "data", JSON.stringify(fullTask));
            } else {
                await redis.lpush(JOB_QUEUE_KEY, JSON.stringify(fullTask));
            }
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
     * Schedule a task to run after a delay
     */
    static async enqueueDelayed(
        task: Omit<JobTask, "receivedAt" | "id"> & { id?: string },
        delayMs: number
    ) {
        try {
            const fullTask = this.buildTask(task);
            const runAt = Date.now() + Math.max(0, delayMs);
            await redis.zadd(JOB_DELAYED_KEY, runAt, JSON.stringify(fullTask));
            logger.info(
                {
                    jobId: fullTask.id,
                    jobType: fullTask.type,
                    runAt
                },
                "[JobQueue] Scheduled job"
            );
            return fullTask.id;
        } catch (error: any) {
            logger.error(`[JobQueue] Failed to schedule: ${error.message}`);
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

            if (USE_STREAMS) {
                await this.ensureStreamGroup();

                const claimed = await (redis as any).xautoclaim(
                    JOB_STREAM_KEY,
                    JOB_STREAM_GROUP,
                    JOB_STREAM_CONSUMER,
                    JOB_STREAM_IDLE_MS,
                    "0-0",
                    "COUNT",
                    1
                );
                if (claimed && claimed[1] && claimed[1].length > 0) {
                    return this.parseStreamEntry(claimed[1][0]);
                }

                const result = await redis.xreadgroup(
                    "GROUP",
                    JOB_STREAM_GROUP,
                    JOB_STREAM_CONSUMER,
                    "BLOCK",
                    timeout * 1000,
                    "COUNT",
                    1,
                    "STREAMS",
                    JOB_STREAM_KEY,
                    ">"
                );
                if (!result) return null;
                const entry = result[0][1][0];
                return this.parseStreamEntry(entry);
            }

            const result = await redis.brpop(JOB_QUEUE_KEY, timeout);
            if (!result) return null;
            return JSON.parse(result[1]) as JobTask;
        } catch (error: any) {
            logger.error(`[JobQueue] Error dequeuing: ${error.message}`);
            return null;
        }
    }

    static async ack(task: JobTask) {
        if (!USE_STREAMS) return;
        if (!task.streamId) return;
        try {
            await redis.xack(JOB_STREAM_KEY, JOB_STREAM_GROUP, task.streamId);
        } catch (error: any) {
            logger.error(`[JobQueue] Failed to ack: ${error.message}`);
        }
    }

    static async retry(task: JobTask, errorMsg: string) {
        if (USE_STREAMS && task.streamId) {
            await this.ack(task);
        }
        const attempt = (task.attempt ?? 0) + 1;
        const maxAttempts = task.maxAttempts ?? WEBHOOK_RETRY_DEFAULTS.MAX_ATTEMPTS;
        const updated: JobTask = {
            ...task,
            attempt,
            maxAttempts,
            lastError: errorMsg,
            streamId: undefined,
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
        if (USE_STREAMS) {
            return redis.xlen(JOB_STREAM_KEY);
        }
        return redis.llen(JOB_QUEUE_KEY);
    }
}
