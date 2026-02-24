import { Context } from "hono";
import { logger } from "@/infra/logger-instance";
import { WebhookQueue } from "@/utils/webhook-queue.util";
import { getISTDate } from "@/utils/date.util";
import crypto from "node:crypto";

export class WebhookController {
    /**
     * Handle Provider Webhooks (Producer Pattern)
     * Route: POST /webhook/:type/:provider/:legalentity
     */
    async handleProviderWebhook(c: Context) {
        const type = c.req.param("type").toUpperCase() as "PAYIN" | "PAYOUT" | "COMMON";
        const providerId = c.req.param("provider");
        const legalEntityId = c.req.param("legalentity") || "";
        const rawBody = await c.req.text();
        const webhookId = crypto.randomUUID();

        logger.info(
            {
                event: "webhook.received",
                source: "PROVIDER_WEBHOOK",
                type,
                providerId,
                legalEntityId,
                webhookId,
                rawBodyLength: rawBody.length,
                rawBody,
                headers: Object.fromEntries(c.req.raw.headers.entries())
            },
            "[Webhook Producer] Received webhook"
        );

        try {
            // Queue for Async Processing directly with payload (JSON)
            await WebhookQueue.enqueue({
                type,
                providerId,
                legalEntityId,
                webhookId,
                rawBody
            });

            return c.json({
                success: true,
                message: "Webhook accepted for processing"
            });

        } catch (error: any) {
            logger.error(`[Webhook Producer] Critical Error: ${error.message}`);
            return c.json({ success: false, error: "Internal processing failure" }, 500);
        }
    }

    /**
     * Debug Webhook Capture (log only, no storage)
     * Route: POST /webhook/debug or /webhook/debug/:tag
     */
    async handleDebugWebhook(c: Context) {
        const tag = c.req.param("tag") || "default";
        const rawBody = await c.req.text();
        const headers = Object.fromEntries(c.req.raw.headers.entries());
        const query = c.req.query();
        const receivedAt = getISTDate().toISOString();

        logger.info(
            {
                tag,
                receivedAt,
                headers,
                query,
                body: rawBody,
                bodyLength: rawBody.length,
            },
            "[Webhook Debug] Captured webhook"
        );

        return c.json({
            success: true,
            message: "Debug webhook captured",
            data: { tag, receivedAt },
        });
    }
}

export const webhookController = new WebhookController();
