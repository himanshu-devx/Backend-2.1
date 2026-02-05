import axios from "axios";
import { BaseProvider, PayinRequest, PayoutRequest, ProviderResponse } from './base-provider';
import { logger } from '@/infra/logger-instance';
import { ENV } from "@/config/env";

/**
 * Dummy Payment Provider
 * Simulates real-world provider behavior with random responses and delayed webhooks.
 */
export class DummyProvider extends BaseProvider {
    constructor(config: any) {
        super(config);
    }

    /**
     * Handle Payin Simulation
     */
    async handlePayin(req: PayinRequest): Promise<ProviderResponse> {
        logger.info(`[DummyProvider] Initiating Payin for ${req.transactionId}`);

        // Generate unique provider reference with timestamp + random component
        const uniqueRef = `DUMMY_PY_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        const result: ProviderResponse = {
            type: 'payin',
            success: true,
            status: 'PENDING',
            message: 'Payment Intent Generated',
            transactionId: req.transactionId,
            providerTransactionId: uniqueRef,
            amount: req.amount,
            result: `https://checkout.dummy.com/pay/${req.transactionId}`
        };

        // Simulate async success webhook after 2 seconds
        // this.dispatchDelayedWebhook({
        //     type: 'PAYIN',
        //     transactionId: req.transactionId,
        //     providerTransactionId: result.providerTransactionId!,
        //     amount: req.amount,
        //     status: 'SUCCESS',
        //     legalEntityId: this.config.legalEntityId || 'default'
        // });

        return result;
    }

    /**
     * Handle Payout Simulation
     */
    async handlePayout(req: PayoutRequest): Promise<ProviderResponse> {
        logger.info(`[DummyProvider] Initiating Payout for ${req.transactionId}`);

        // Generate unique provider reference with timestamp + random component
        const uniqueRef = `DUMMY_PO_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        // Immediate result is always success (Accepted)
        const result: ProviderResponse = {
            type: 'payout',
            success: true,
            status: 'PENDING', // Accepted by "Bank"
            message: 'Payout Request Accepted',
            transactionId: req.transactionId,
            providerTransactionId: uniqueRef,
            amount: req.amount
        };

        // Simulate async result (90% success, 10% failure)
        const outcome = Math.random() > 0.1 ? 'SUCCESS' : 'FAILED';

        // this.dispatchDelayedWebhook({
        //     type: 'PAYOUT',
        //     transactionId: req.transactionId,
        //     providerTransactionId: result.providerTransactionId!,
        //     amount: req.amount,
        //     status: outcome,
        //     legalEntityId: this.config.legalEntityId || 'default'
        // });

        return result;
    }

    /**
     * Status Sync Simulation
     */
    async checkStatus(req: { transactionId: string, providerTransactionId?: string, type: 'PAYIN' | 'PAYOUT' }): Promise<Partial<ProviderResponse>> {
        return {
            status: 'PENDING',
            message: 'Transaction is still being processed in dummy simulation'
        };
    }

    /**
     * Webhook Handler (Not used in simulation since we are the ones sending it)
     */
    async handleWebhook(payload: any, type: 'PAYIN' | 'PAYOUT'): Promise<ProviderResponse> {
        return {
            type: 'webhook',
            success: true,
            status: payload.status,
            message: 'Webhook parsed',
            transactionId: payload.ref_id,
            providerTransactionId: payload.payment_id,
            amount: payload.amount,
            utr: payload.utr || `UTR${Date.now()}`
        };
    }

    /**
     * Helper to dispatch an async webhook after a delay
     */
    private dispatchDelayedWebhook(data: {
        type: 'PAYIN' | 'PAYOUT',
        transactionId: string,
        providerTransactionId: string,
        amount: number,
        status: string,
        legalEntityId: string
    }) {
        const delay = 2000; // 2 seconds
        const apiUrl = ENV.APP_BASE_URL || "http://localhost:4000";
        const webhookUrl = `${apiUrl}/api/webhook/${data.type.toLowerCase()}/dummy/${data.legalEntityId}`;

        const payload = {
            payment_id: data.providerTransactionId,
            status: data.status,
            amount: data.amount,
            ref_id: data.transactionId,
            utr: `SIM_${Date.now()}`,
            message: data.status === 'SUCCESS' ? 'Transaction successful' : 'Bank rejected transaction'
        };

        setTimeout(async () => {
            try {
                logger.info(`[DummyProvider] Dispatching async webhook to ${webhookUrl}`);
                await axios.post(webhookUrl, payload, { timeout: 5000 });
                logger.info(`[DummyProvider] Webhook delivered for ${data.transactionId}`);
            } catch (err: any) {
                logger.error(`[DummyProvider] Webhook delivery failed for ${data.transactionId}: ${err.message}`);
            }
        }, delay);
    }
}
