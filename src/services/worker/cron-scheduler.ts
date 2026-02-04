/**
 * Cron Scheduler Service
 *
 * Manages scheduled jobs for the fintech platform including:
 * - Settlement processing
 * - Balance reconciliation
 * - Balance snapshots
 * - Expired transfer cleanup
 */

import { logger } from "@/infra/logger-instance";
import { ENV } from "@/config/env";

type JobHandler = () => Promise<void>;

interface ScheduledJob {
  name: string;
  cronExpression: string;
  handler: JobHandler;
  isRunning: boolean;
  lastRunAt: Date | null;
  lastRunDuration: number | null;
  lastRunError: string | null;
  nextRunAt: Date | null;
  isEnabled: boolean;
}

// Simple cron parser for basic expressions
// Supports: "*/N" (every N), "*" (every), and specific values
function parseCronExpression(expression: string): {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
} {
  const parts = expression.split(" ");
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }

  const parseField = (field: string, min: number, max: number): number[] => {
    if (field === "*") {
      return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    }
    if (field.startsWith("*/")) {
      const interval = parseInt(field.slice(2), 10);
      const values: number[] = [];
      for (let i = min; i <= max; i += interval) {
        values.push(i);
      }
      return values;
    }
    if (field.includes(",")) {
      return field.split(",").map((v) => parseInt(v, 10));
    }
    if (field.includes("-")) {
      const [start, end] = field.split("-").map((v) => parseInt(v, 10));
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [parseInt(field, 10)];
  };

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function getNextRunTime(cronExpression: string, after: Date = new Date()): Date {
  const parsed = parseCronExpression(cronExpression);
  const next = new Date(after);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Find next matching time (max 1 year lookahead)
  const maxIterations = 525600; // minutes in a year
  for (let i = 0; i < maxIterations; i++) {
    const minute = next.getMinutes();
    const hour = next.getHours();
    const dayOfMonth = next.getDate();
    const month = next.getMonth() + 1;
    const dayOfWeek = next.getDay();

    if (
      parsed.minute.includes(minute) &&
      parsed.hour.includes(hour) &&
      parsed.dayOfMonth.includes(dayOfMonth) &&
      parsed.month.includes(month) &&
      parsed.dayOfWeek.includes(dayOfWeek)
    ) {
      return next;
    }

    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(`Could not find next run time for cron: ${cronExpression}`);
}

export class CronScheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  /**
   * Registers a new scheduled job
   */
  registerJob(
    name: string,
    cronExpression: string,
    handler: JobHandler,
    enabled: boolean = true
  ): void {
    const nextRunAt = enabled ? getNextRunTime(cronExpression) : null;

    this.jobs.set(name, {
      name,
      cronExpression,
      handler,
      isRunning: false,
      lastRunAt: null,
      lastRunDuration: null,
      lastRunError: null,
      nextRunAt,
      isEnabled: enabled,
    });

    logger.info(
      { jobName: name, cronExpression, nextRunAt, enabled },
      "Cron job registered"
    );
  }

  /**
   * Starts the scheduler
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("Scheduler already running");
      return;
    }

    this.isRunning = true;
    logger.info("Starting cron scheduler");

    for (const [name, job] of this.jobs) {
      if (job.isEnabled) {
        this.scheduleNextRun(name);
      }
    }
  }

  /**
   * Stops the scheduler
   */
  stop(): void {
    this.isRunning = false;

    for (const [name, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(name);
    }

    logger.info("Cron scheduler stopped");
  }

  /**
   * Manually triggers a job
   */
  async triggerJob(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job not found: ${name}`);
    }

    await this.runJob(name);
  }

  /**
   * Gets status of all jobs
   */
  getJobsStatus(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Enables or disables a job
   */
  setJobEnabled(name: string, enabled: boolean): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job not found: ${name}`);
    }

    job.isEnabled = enabled;

    if (enabled && this.isRunning) {
      job.nextRunAt = getNextRunTime(job.cronExpression);
      this.scheduleNextRun(name);
    } else {
      const timer = this.timers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(name);
      }
      job.nextRunAt = null;
    }

    logger.info({ jobName: name, enabled }, "Job enabled state changed");
  }

  private scheduleNextRun(name: string): void {
    const job = this.jobs.get(name);
    if (!job || !job.isEnabled || !this.isRunning) return;

    const now = new Date();
    const nextRun = getNextRunTime(job.cronExpression, now);
    job.nextRunAt = nextRun;

    const delay = nextRun.getTime() - now.getTime();

    const timer = setTimeout(async () => {
      await this.runJob(name);
      if (this.isRunning && job.isEnabled) {
        this.scheduleNextRun(name);
      }
    }, delay);

    this.timers.set(name, timer);
  }

  private async runJob(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) return;

    if (job.isRunning) {
      logger.warn({ jobName: name }, "Job already running, skipping");
      return;
    }

    job.isRunning = true;
    const startTime = Date.now();

    logger.info({ jobName: name }, "Starting scheduled job");

    try {
      await job.handler();
      job.lastRunError = null;
      logger.info(
        { jobName: name, durationMs: Date.now() - startTime },
        "Scheduled job completed"
      );
    } catch (error: any) {
      job.lastRunError = error.message;
      logger.error(
        { jobName: name, error, durationMs: Date.now() - startTime },
        "Scheduled job failed"
      );
    } finally {
      job.isRunning = false;
      job.lastRunAt = new Date();
      job.lastRunDuration = Date.now() - startTime;
    }
  }
}

// Singleton instance
export const cronScheduler = new CronScheduler();
