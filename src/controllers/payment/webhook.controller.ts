import { Context } from "hono";
import { logger } from "@/infra/logger-instance";
import { WebhookQueue } from "@/utils/webhook-queue.util";

export class WebhookController {
    /**
     * Handle Provider Webhooks (Producer Pattern)
     * Route: POST /webhook/:type/:provider/:legalentity
     */
    async handleProviderWebhook(c: Context) {
        const type = c.req.param("type").toUpperCase() as "PAYIN" | "PAYOUT";
        const providerId = c.req.param("provider");
        const legalEntityId = c.req.param("legalentity");
        const payload = await c.req.json();

        logger.info(`[Webhook Producer] Received ${type} from ${providerId}/${legalEntityId}`);

        try {
            // Queue for Async Processing directly with payload (JSON)
            await WebhookQueue.enqueue({
                type,
                providerId,
                legalEntityId,
                payload
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
}

export const webhookController = new WebhookController();

