console.log("API INSTANCE LOADED"); // Trigger Restart
import { buildApp } from "@/app";
import { bootstrap } from "@/bootstrap";
import { handler } from "@/utils/handler";
import authRoutes from "@/routes/auth";
import { ENV } from "@/config/env";
import adminRoutes from "@/routes/admin";
import merchantRoutes from "@/routes/merchant";
import webhookRoutes from "@/routes/payment/webhook.routes";
import { rateLimiter } from "@/middlewares/rate-limiter";
import "@/infra/otel-sdk";
import { serve } from "@hono/node-server";
import { startLedgerJobs } from "@/jobs/ledger.jobs";

await bootstrap();

try {
  startLedgerJobs();
} catch (error) {
  console.error("Failed to start ledger cron jobs (continuing application)", error);
}

const app = buildApp("api");

app.use("*", rateLimiter(ENV.RATE_LIMIT_MAX, ENV.RATE_LIMIT_WINDOW));
app.route("/api/auth", authRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/merchant", merchantRoutes);
app.route("/webhook", webhookRoutes);


// ... previous imports are fine, but ensure layout matches
// I will just replace the end of the file or the whol file if simpler.
// Let's replace the export default block.

// /health
app.get(
  "/health",
  handler(async (c, logger) => {
    logger.info("health check ok");
    return c.text("ok");
  })
);

const port = Number(ENV.API_PORT) || 4000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});
