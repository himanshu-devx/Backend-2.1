/**
 * Base Provider Interface
 * All payment gateway providers must extend this class
 */

export interface PayinRequest {
    amount: number;
    transactionId: string; // Our internal transaction ID
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    redirectUrl?: string;
    callbackUrl?: string;
    remarks?: string;
    mode?: string; // INTENT, QR, UPI, etc.
    company?: string; // For webhook URL construction
    [key: string]: any; // Allow additional provider-specific fields
}

export interface PayoutRequest {
    amount: number;
    transactionId: string; // Our internal transaction ID
    beneficiaryName: string;
    beneficiaryAccountNumber: string;
    beneficiaryBankIfsc: string;
    beneficiaryBankName?: string;
    beneficiaryAddress?: string;
    mode?: string; // IMPS, NEFT, RTGS
    remarks?: string;
    [key: string]: any; // Allow additional provider-specific fields
}

export interface ProviderResponse {
    type: 'payin' | 'payout' | 'webhook';
    success: boolean;
    status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'EXPIRED';
    message: string;
    providerMsg?: string;
    transactionId: string; // Our internal transaction ID
    providerTransactionId?: string; // Provider's transaction ID
    amount: number;
    utr?: string; // Unique Transaction Reference
    result?: any; // Payment link, UPI intent, or other provider-specific data
    error?: any;
    customerName?: string;
    redirectUrl?: string;
    callbackUrl?: string;
    [key: string]: any; // Allow additional fields
}

/**
 * Base Provider Class
 * All payment gateway providers must extend this class
 */
export abstract class BaseProvider {
    protected config: any;
    protected providerId: string;

    constructor(config: any) {
        this.config = config;
        this.providerId = config.providerId;
    }

    /**
     * Handle Payin (Payment Collection)
     * @param reqData - Payin request data
     * @returns Provider response
     */
    abstract handlePayin(reqData: PayinRequest): Promise<ProviderResponse>;

    /**
     * Handle Payout (Payment Disbursement)
     * @param reqData - Payout request data
     * @returns Provider response
     */
    abstract handlePayout(reqData: PayoutRequest): Promise<ProviderResponse>;

    /**
     * Handle Webhook Callback
     * @param payload - Webhook payload from provider
     * @param type - Transaction type (PAYIN or PAYOUT)
     * @returns Provider response
     */
    abstract handleWebhook(payload: any, type: 'PAYIN' | 'PAYOUT'): Promise<ProviderResponse>;

    /**
     * Proactive Status Sync
     */
    abstract checkStatus(req: { transactionId: string, providerTransactionId?: string, type: 'PAYIN' | 'PAYOUT' }): Promise<Partial<ProviderResponse>>;

    /**
     * Normalize provider status to our standard statuses
     * @param status - Provider-specific status
     * @returns Normalized status
     */
    protected normalizeStatus(status: string): 'SUCCESS' | 'PENDING' | 'FAILED' | 'EXPIRED' {
        const s = (status || '').toUpperCase();

        // Success states
        if (['SUCCESS', 'PROCESSED', 'COMPLETED', 'CAPTURED', 'PAID', 'SETTLED'].includes(s)) {
            return 'SUCCESS';
        }

        // Expired states
        if (['EXPIRED', 'TIMEOUT', 'CANCELLED'].includes(s)) {
            return 'EXPIRED';
        }

        // Failed states
        if (['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'ERROR'].includes(s)) {
            return 'FAILED';
        }

        // Default to pending
        return 'PENDING';
    }

    /**
     * Format error response
     * @param type - Transaction type
     * @param transactionId - Our transaction ID
     * @param amount - Transaction amount
     * @param error - Error object or message
     * @returns Formatted error response
     */
    protected formatErrorResponse(
        type: 'payin' | 'payout' | 'webhook',
        transactionId: string,
        amount: number,
        error: any
    ): ProviderResponse {
        return {
            type,
            success: false,
            status: 'FAILED',
            message: error.message || 'Provider request failed',
            providerMsg: error.response?.data?.message || error.message,
            transactionId,
            amount,
            error: error.response?.data || error,
        };
    }
}
