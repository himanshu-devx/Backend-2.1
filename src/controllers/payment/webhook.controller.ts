import { Context } from "hono";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { ProviderFactory } from "@/providers/provider-factory";
import { PayoutService, payoutService } from "@/services/payment/payout.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import axios from "axios";
import { CacheService } from "@/services/common/cache.service";

export class WebhookController {
    /**
     * Handle AlphaPay Webhook
     * Route: POST /webhook/:type/:provider/:legalentity
     */
    async handleAlphaPayWebhook(c: Context) {
        const type = c.req.param("type").toUpperCase() as "PAYIN" | "PAYOUT";
        const providerId = c.req.param("provider");
        const legalEntityId = c.req.param("legalentity");
        const payload = await c.req.json();

        logger.info(`[Webhook] Received ${providerId} ${type} webhook via legal entity: ${legalEntityId}`);

        try {
            // 1. Get the provider instance to parse the webhook
            // Find the PLE ID using provider and legal entity
            const ple = await CacheService.getChannel(providerId, legalEntityId);
            if (!ple) {
                logger.error(`[Webhook] PLE not found for ${providerId}/${legalEntityId}`);
                return c.json({ success: false, message: "PLE not found" }, 404);
            }

            const provider = ProviderFactory.getProvider(ple.id);
            const result = await provider.handleWebhook(payload, type);

            if (!result.transactionId) {
                logger.error("[Webhook] No transactionId in webhook result");
                return c.json({ success: false, message: "Invalid payload" }, 400);
            }

            // 2. Find the transaction
            const transaction = await TransactionModel.findOne({ id: result.transactionId });
            if (!transaction) {
                logger.error(`[Webhook] Transaction ${result.transactionId} not found`);
                return c.json({ success: false, message: "Transaction not found" }, 404);
            }

            // 3. Process the update
            if (transaction.status !== TransactionStatus.PENDING) {
                logger.info(`[Webhook] Transaction ${transaction.id} already in ${transaction.status} status`);
                return c.json({ success: true, message: "Already processed" });
            }

            if (type === "PAYOUT") {
                await this.handlePayoutUpdate(transaction, result);
            } else {
                await this.handlePayinUpdate(transaction, result);
            }

            // 4. Send callback to merchant
            await this.sendMerchantCallback(transaction);

            return c.json({ success: true });
        } catch (error: any) {
            logger.error(`[Webhook] Processing failed: ${error.message}`);
            return c.json({ success: false, error: error.message }, 500);
        }
    }

    private async handlePayoutUpdate(transaction: any, result: any) {
        transaction.providerRef = result.providerTransactionId || transaction.providerRef;
        transaction.utr = result.utr || transaction.utr;

        if (result.status === "SUCCESS") {
            // Success: Post (Commit) TigerBeetle transfer
            await payoutService.postPayoutTransfer(transaction);
            transaction.status = TransactionStatus.SUCCESS;

            transaction.events.push({
                type: "WEBHOOK_SUCCESS",
                timestamp: getISTDate(),
                payload: result
            });
        } else if (result.status === "FAILED") {
            // Failed: Void TigerBeetle transfer
            await payoutService.voidPayoutTransfer(transaction);
            transaction.status = TransactionStatus.FAILED;
            transaction.meta.set("error", result.message || "Payout failed via webhook");

            transaction.events.push({
                type: "WEBHOOK_FAILED",
                timestamp: getISTDate(),
                payload: result
            });
        }

        await transaction.save();
    }

    private async handlePayinUpdate(transaction: any, result: any) {
        // For Payin, we usually don't have a pending TB transfer during initialization
        // The money movement happens here in the webhook

        transaction.providerRef = result.providerTransactionId || transaction.providerRef;
        transaction.utr = result.utr || transaction.utr;

        if (result.status === "SUCCESS") {
            // In a real system, you might need to check if money movement was already done
            // For AlphaPay payin, we typically execute money movement after webhook

            // Let's assume PayinService handles the ledger part elsewhere or we call it here
            // But based on user request "webhook success then post tiger bettle traction and store utr"
            // it seems they primarily care about Payout flow for now, but suggested webhooks in general.

            transaction.status = TransactionStatus.SUCCESS;
            transaction.events.push({
                type: "WEBHOOK_SUCCESS",
                timestamp: getISTDate(),
                payload: result
            });
        } else if (result.status === "FAILED" || result.status === "EXPIRED") {
            transaction.status = result.status === "EXPIRED" ? TransactionStatus.EXPIRED : TransactionStatus.FAILED;
            transaction.events.push({
                type: "WEBHOOK_FAILED",
                timestamp: getISTDate(),
                payload: result
            });
        }

        await transaction.save();
    }

    private async sendMerchantCallback(transaction: any) {
        const merchant = await CacheService.getMerchant(transaction.merchantId);
        if (!merchant) return;

        const callbackUrl = transaction.type === "PAYIN" ? merchant.payin.callbackUrl : merchant.payout.callbackUrl;
        if (!callbackUrl) {
            logger.info(`[Callback] No callback URL configured for merchant ${merchant.id}`);
            return;
        }

        const payload = {
            orderId: transaction.orderId,
            transactionId: transaction.id,
            amount: transaction.amount,
            status: transaction.status,
            utr: transaction.utr,
            type: transaction.type,
            remarks: transaction.remarks,
            timestamp: transaction.updatedAt || new Date()
        };

        try {
            logger.info(`[Callback] Sending to ${callbackUrl}`);
            await axios.post(callbackUrl, payload, { timeout: 10000 });
            logger.info(`[Callback] Success for ${transaction.id}`);
        } catch (error: any) {
            logger.error(`[Callback] Failed for ${transaction.id}: ${error.message}`);
            // Optional: Add retry logic or queue
        }
    }
}

export const webhookController = new WebhookController();
