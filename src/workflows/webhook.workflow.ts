import { TransactionModel, TransactionStatus, TransactionDocument } from "@/models/transaction.model";
import { ProviderFactory } from "@/providers/provider-factory";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { PaymentLedgerService } from "./payment-ledger.service";
import axios from "axios";

export class WebhookWorkflow {
    async execute(type: "PAYIN" | "PAYOUT", providerId: string, legalEntityId: string, payload: any) {
        logger.info(`[WebhookWorkflow] Processing ${type} for ${providerId}/${legalEntityId}`);

        // 1. Resolve Channel
        const ple = await CacheService.getChannel(providerId, legalEntityId);
        if (!ple) throw new Error("Channel not found");

        // 2. Parse & Verify (State Transition Check)
        const provider = ProviderFactory.getProvider(ple.id);
        const result = await provider.handleWebhook(payload, type);

        if (!result.transactionId) throw new Error("No transactionId in webhook");

        // 3. Persistent Record & Lock
        const transaction = await TransactionModel.findOne({ id: result.transactionId });
        if (!transaction) throw new Error(`Txn ${result.transactionId} not found`);

        if (transaction.status !== TransactionStatus.PENDING) {
            return { transaction, alreadyProcessed: true };
        }

        // 4. State Update
        transaction.providerRef = result.providerTransactionId || transaction.providerRef;
        transaction.utr = result.utr || transaction.utr;

        try {
            if (result.status === "SUCCESS") {
                transaction.status = TransactionStatus.SUCCESS;
                transaction.events.push({ type: "WEBHOOK_SUCCESS", timestamp: getISTDate(), payload: result });

                // Execute Financial Transition
                if (type === "PAYIN") {
                    await PaymentLedgerService.processPayinCredit(transaction);
                } else {
                    await PaymentLedgerService.commitPayout(transaction);
                }
            } else if (result.status === "FAILED") {
                transaction.status = TransactionStatus.FAILED;
                transaction.error = result.message || "Provider reported failure";
                transaction.events.push({ type: "WEBHOOK_FAILED", timestamp: getISTDate(), payload: result });

                if (type === "PAYOUT") {
                    await PaymentLedgerService.rollbackPayout(transaction);
                }
            }

            await transaction.save();

            // 5. Outbound Notification
            this.notifyMerchant(transaction);

            return { transaction, alreadyProcessed: false };

        } catch (error: any) {
            logger.error(`[WebhookWorkflow] Critical Error for ${transaction.id}: ${error.message}`);
            // We don't mark as FAILED here if it's a code error (e.g. ledger down), 
            // so we can retry the webhook.
            throw error;
        }
    }

    private async notifyMerchant(transaction: TransactionDocument) {
        if (!transaction.merchantId) return;
        const merchant = await CacheService.getMerchant(transaction.merchantId);
        if (!merchant) return;

        const callbackUrl = transaction.type === "PAYIN" ? merchant.payin.callbackUrl : merchant.payout.callbackUrl;
        if (!callbackUrl) return;

        const payload = {
            orderId: transaction.orderId,
            transactionId: transaction.id,
            amount: transaction.amount,
            status: transaction.status,
            utr: transaction.utr,
            type: transaction.type,
            timestamp: getISTDate()
        };

        axios.post(callbackUrl, payload, { timeout: 5000 }).catch(err => {
            logger.warn(`[Callback] Failed for ${transaction.id}: ${err.message}`);
        });
    }
}
