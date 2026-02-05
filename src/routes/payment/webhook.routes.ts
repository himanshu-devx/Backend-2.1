import { Hono } from "hono";
import { webhookController } from "@/controllers/payment/webhook.controller";

const router = new Hono();

/**
 * Common webhook route for all providers
 * Example: POST /webhook/payin/alphapay/wisipay
 *          POST /webhook/payout/alphapay/wisipay
 */
router.post("/:type/:provider/:legalentity", (c) => webhookController.handleProviderWebhook(c));

// Placeholder for other providers if they have different structures
// router.post("/razorpay", (c) => webhookController.handleRazorpayWebhook(c));

export default router;
