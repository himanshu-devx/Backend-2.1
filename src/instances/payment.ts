console.log("PAYMENT INSTANCE LOADED");
import { buildApp } from "@/app";
import { bootstrap } from "@/bootstrap";
import { handler } from "@/utils/handler";
import { ENV } from "@/config/env";
import paymentRoutes from "@/routes/payment/payment.routes";
import webhookRoutes from "@/routes/payment/webhook.routes";
import { rateLimiter } from "@/middlewares/rate-limiter";
import { serve } from "@hono/node-server";

await bootstrap();
const app = buildApp();

// Payment specific middlewares
app.use("*", rateLimiter(ENV.RATE_LIMIT_MAX, ENV.RATE_LIMIT_WINDOW));

// Mount Payment Routes
app.route("/api/payment", paymentRoutes);

// Mount Webhook Routes (CRITICAL: webhooks must update the same ledger as payment operations)
app.route("/webhook", webhookRoutes);

// Health Check
app.get(
  "/health",
  handler(async (c, logger) => {
    logger.info("payment instance health check ok");
    return c.text("ok");
  })
);

// Use a designated port for Payment Service, fallback to 3001 to avoid conflict with API (3000)
const port = Number(ENV.PAYMENT_PORT) || 3000;
console.log(`Payment Instance is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});
