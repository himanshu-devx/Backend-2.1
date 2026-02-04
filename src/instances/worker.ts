/**
 * Worker Instance
 *
 * Background job processor for the fintech platform.
 * Handles scheduled tasks like settlements, reconciliation, and cleanup.
 *
 * Run with: bun run src/instances/worker.ts
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";
import { connectMongo } from "@/infra/mongoose-instance";
import { connectPostgres } from "@/infra/postgres/connection";
import { runMigrations } from "@/infra/postgres/migrate";
import { cronScheduler } from "@/services/worker/cron-scheduler";

// Import jobs
import {
  runMerchantSettlementJob,
  runProviderSettlementJob,
  runExpiredTransferCleanupJob,
} from "@/services/worker/jobs/settlement.job";
import {
  runReconciliationJob,
  runBalanceSnapshotJob,
  runConstraintValidationJob,
} from "@/services/worker/jobs/reconciliation.job";

const app = new Hono();

// Middleware
app.use("*", secureHeaders());
app.use("*", cors());

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    service: "worker",
    timestamp: new Date().toISOString(),
    jobs: cronScheduler.getJobsStatus().map((job) => ({
      name: job.name,
      isEnabled: job.isEnabled,
      isRunning: job.isRunning,
      lastRunAt: job.lastRunAt?.toISOString(),
      lastRunDuration: job.lastRunDuration,
      nextRunAt: job.nextRunAt?.toISOString(),
      lastRunError: job.lastRunError,
    })),
  });
});

// Manual job trigger endpoints (protected by internal network)
app.post("/jobs/:jobName/trigger", async (c) => {
  const jobName = c.req.param("jobName");

  try {
    await cronScheduler.triggerJob(jobName);
    return c.json({ success: true, message: `Job ${jobName} triggered` });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400);
  }
});

// Enable/disable job
app.post("/jobs/:jobName/toggle", async (c) => {
  const jobName = c.req.param("jobName");
  const { enabled } = await c.req.json();

  try {
    cronScheduler.setJobEnabled(jobName, enabled);
    return c.json({ success: true, message: `Job ${jobName} ${enabled ? "enabled" : "disabled"}` });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400);
  }
});

// List all jobs
app.get("/jobs", (c) => {
  return c.json({
    jobs: cronScheduler.getJobsStatus(),
  });
});

async function bootstrap() {
  logger.info("Starting Worker Instance...");

  // Connect to MongoDB (for models/repositories)
  await connectMongo();
  logger.info("MongoDB connected");

  // Connect to PostgreSQL (for ledger)
  await connectPostgres();
  logger.info("PostgreSQL connected");

  // Run migrations
  await runMigrations();
  logger.info("PostgreSQL migrations completed");

  // Register scheduled jobs
  registerJobs();

  // Start the scheduler
  cronScheduler.start();
  logger.info("Cron scheduler started");
}

function registerJobs() {
  // Settlement Jobs
  // Run merchant settlement every hour at minute 0
  cronScheduler.registerJob(
    "merchant-settlement",
    "0 * * * *", // Every hour
    runMerchantSettlementJob,
    ENV.CRON_SETTLEMENT_ENABLED
  );

  // Run provider settlement every 6 hours
  cronScheduler.registerJob(
    "provider-settlement",
    "0 */6 * * *", // Every 6 hours
    runProviderSettlementJob,
    ENV.CRON_SETTLEMENT_ENABLED
  );

  // Expired transfer cleanup every 15 minutes
  cronScheduler.registerJob(
    "expired-transfer-cleanup",
    "*/15 * * * *", // Every 15 minutes
    runExpiredTransferCleanupJob,
    true
  );

  // Reconciliation Jobs
  // Run reconciliation daily at 2 AM
  cronScheduler.registerJob(
    "reconciliation",
    "0 2 * * *", // Daily at 2 AM
    runReconciliationJob,
    ENV.CRON_RECONCILIATION_ENABLED
  );

  // Run constraint validation every 4 hours
  cronScheduler.registerJob(
    "constraint-validation",
    "0 */4 * * *", // Every 4 hours
    runConstraintValidationJob,
    ENV.CRON_RECONCILIATION_ENABLED
  );

  // Balance snapshot daily at midnight
  cronScheduler.registerJob(
    "balance-snapshot",
    "0 0 * * *", // Daily at midnight
    runBalanceSnapshotJob,
    ENV.CRON_SNAPSHOT_ENABLED
  );

  logger.info("Scheduled jobs registered");
}

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down...");
  cronScheduler.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down...");
  cronScheduler.stop();
  process.exit(0);
});

// Start the worker
bootstrap()
  .then(() => {
    const port = ENV.WORKER_PORT;
    serve({
      fetch: app.fetch,
      port,
    });
    logger.info(`Worker instance running on port ${port}`);
  })
  .catch((error) => {
    logger.error({ error }, "Failed to start worker instance");
    process.exit(1);
  });

export default app;
