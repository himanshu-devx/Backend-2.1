import crypto from "crypto";
import axios from "axios";
import { BaseProvider, PayinRequest, PayoutRequest, ProviderResponse } from './base-provider';
import { logger } from '@/infra/logger-instance';

/**
 * Internal Credentials Storage
 * Mapping PLE ID to specific AlphaPay credentials
 */
const ALPHAPAY_CREDENTIALS: Record<string, { apiKey: string, apiSalt: string, baseUrl: string }> = {
    "PLE-1":
    {
        apiKey: "VaXEMBDR9xmFIoahL3VNv747dTaU7P7T",
        apiSalt: "Jdl1Xvx5NROAWCI3",
        baseUrl: "https://dashboard.alphapayfintechsolutions.net",

    }
    // Add more PLE mappings as needed
};

/**
 * AlphaPay Payment Gateway Provider
 * Handles payin and payout operations with encryption
 */
export class AlphaPayProvider extends BaseProvider {
    private baseUrl: string;
    private apiKey: string;
    private apiSalt: string;

    constructor(config: any) {
        super(config);

        // Lookup credentials from internal storage based on PLE ID
        const pleId = config.id || "PLE-1";
        const creds = ALPHAPAY_CREDENTIALS[pleId];

        if (!creds) {
            logger.warn(`[AlphaPay] No specific credentials found for PLE: ${pleId}. Falling back to config/env.`);
            this.baseUrl = config.baseUrl || config.base_url;
            this.apiKey = config.credentials?.apiKey || config.credentials?.api_key || "";
            this.apiSalt = config.credentials?.apiSalt || config.credentials?.api_salt || "";
        } else {
            this.baseUrl = creds.baseUrl;
            this.apiKey = creds.apiKey;
            this.apiSalt = creds.apiSalt;
        }
    }

    /**
     * Encrypt request data using AES-256-CBC
     */
    private encryptRequest(data: any): string {
        if (!this.apiKey || !this.apiSalt) {
            throw new Error("Encryption failed: apiKey or apiSalt is missing.");
        }
        const key = Buffer.from(this.apiKey, "utf8"); // 32-byte key
        const iv = Buffer.from(this.apiSalt, "utf8"); // 16-byte IV

        if (key.length !== 32) throw new Error("Key must be 32 bytes");
        if (iv.length !== 16) throw new Error("IV must be 16 bytes");

        const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
        let encrypted = cipher.update(JSON.stringify(data), "utf8", "base64");
        encrypted += cipher.final("base64");
        return encrypted;
    }

    /**
     * Decrypt payload using AES-256-CBC
     */
    private decryptPayload(encryptedData: string): any {
        if (!this.apiKey || !this.apiSalt) {
            throw new Error("Decryption failed: apiKey or apiSalt is missing.");
        }
        const key = Buffer.from(this.apiKey, "utf8");
        const iv = Buffer.from(this.apiSalt, "utf8");

        if (key.length !== 32) throw new Error("Key must be 32 bytes");
        if (iv.length !== 16) throw new Error("IV must be 16 bytes");

        const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        let decrypted = decipher.update(encryptedData, "base64", "utf8");
        decrypted += decipher.final("utf8");
        return JSON.parse(decrypted);
    }

    /**
     * Handle Payin
     */
    async handlePayin(reqData: PayinRequest): Promise<ProviderResponse> {
        try {
            logger.info(`[AlphaPay] Creating payin for transaction: ${reqData.transactionId}`);

            let redirectUrl = reqData.redirectUrl || "www.google.com";
            if (!redirectUrl.startsWith("http")) {
                redirectUrl = "https://" + redirectUrl;
            }

            const payload = {
                amount: Number(reqData.amount),
                payment_mode: "INTENT",
                callback_url: reqData.callbackUrl || `${process.env.APP_BASE_URL}/webhook/payin/${reqData.company}/alphapay`,
                redirect_url: redirectUrl,
                customer_name: reqData.customerName,
                customer_details: {
                    customer_email: reqData.customerEmail,
                    customer_phone: reqData.customerPhone,
                },
                ref_id: reqData.transactionId,
                remarks: reqData.remarks || "Payment",
            };

            logger.info(payload, "[AlphaPay] Payin Request Payload");

            const encryptedPayload = this.encryptRequest(payload);

            const response = await axios.post(
                `${this.baseUrl}/api/v1/create-payment`,
                { payload: encryptedPayload },
                {
                    headers: {
                        "X-Api-Key": this.apiKey,
                        "X-Api-Salt": this.apiSalt,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                }
            );

            if (!response.data.success) {
                logger.error(`[AlphaPay] Payin API failed for txn ${reqData.transactionId}:`, response.data.error);
                return {
                    type: "payin",
                    success: false,
                    message: response.data.error?.errors || "Provider Failed Request",
                    providerMsg: response.data.error?.message || "",
                    status: "FAILED",
                    transactionId: reqData.transactionId,
                    amount: reqData.amount,
                    error: response.data.error,
                };
            }

            const data = response.data.data;

            logger.info(response.data, "[AlphaPay] Payin Response Body");

            // For now, return payment link directly
            // TODO: Implement QR code scraping if needed
            const upiIntent = data.payment_link;

            logger.info(`[AlphaPay] Payin created: ${data.payment_id}`);

            return {
                type: "payin",
                success: true,
                message: "Transaction Pending",
                status: "PENDING",
                transactionId: reqData.transactionId,
                amount: data.amount,
                providerTransactionId: data.payment_id,
                result: upiIntent,
                customerName: data.customer_name,
                redirectUrl: data.redirect_url,
                callbackUrl: data.callback_url,
            };
        } catch (err: any) {
            logger.error(`[AlphaPay] Payin Exception: ${err.message}`, err);
            return this.formatErrorResponse('payin', reqData.transactionId, reqData.amount, err);
        }
    }

    /**
     * Handle Payout
     */
    async handlePayout(reqData: PayoutRequest): Promise<ProviderResponse> {
        try {
            logger.info(`[AlphaPay] Creating payout for transaction: ${reqData.transactionId}`);

            const payload = {
                amount: parseInt(reqData.amount.toString()),
                payment_mode: reqData.mode || "IMPS",
                beneficiary_ifsc: reqData.beneficiaryBankIfsc,
                beneficiary_acc_number: reqData.beneficiaryAccountNumber,
                beneficiary_bank_name: reqData.beneficiaryBankName,
                beneficiary_name: reqData.beneficiaryName,
                beneficiary_address: reqData.beneficiaryAddress || "",
                ref_id: reqData.transactionId,
                remarks: reqData.remarks || "Payout",
            };

            logger.info(payload, "[AlphaPay] Payout Request Payload");

            const encryptedPayload = this.encryptRequest(payload);

            const response = await axios.post(
                `${this.baseUrl}/api/v1/payout/request-payout`,
                { payload: encryptedPayload },
                {
                    headers: {
                        "X-Api-Key": this.apiKey,
                        "X-Api-Salt": this.apiSalt,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                }
            );

            if (!response.data.success) {
                logger.error(`[AlphaPay] Payout API failed for txn ${reqData.transactionId}:`, response.data.error);
                return {
                    type: "payout",
                    success: false,
                    message: response.data.error?.errors || "Provider Failed Request",
                    providerMsg: response.data.error?.message || "",
                    status: "FAILED",
                    transactionId: reqData.transactionId,
                    amount: reqData.amount,
                    error: response.data.error,
                };
            }


            const data = response.data.data;

            logger.info(response.data, "[AlphaPay] Payout Response Body");

            logger.info(`[AlphaPay] Payout created: ${data.request_id}, status: ${data.status}`);

            return {
                type: "payout",
                success: true,
                message: data.message,
                status: this.normalizeStatus(data.status),
                transactionId: reqData.transactionId,
                providerTransactionId: data.request_id,
                amount: data.amount,
                utr: data.utr_number,
            };
        } catch (err: any) {
            logger.error(`[AlphaPay] Payout Exception: ${err.message}`, err);
            return this.formatErrorResponse('payout', reqData.transactionId, reqData.amount, err);
        }
    }

    /**
     * Handle Webhook
     */
    async handleWebhook(payload: any, type: 'PAYIN' | 'PAYOUT'): Promise<ProviderResponse> {
        try {
            logger.info(payload, `[AlphaPay] Webhook Received (${type})`);

            // CASE 1: MANUAL WEBHOOK (Testing)
            if (payload.manual === true) {
                const normalizedStatus = this.normalizeStatus(payload.status);

                return {
                    type: type.toLowerCase() as 'payin' | 'payout',
                    success: normalizedStatus === "SUCCESS",
                    status: normalizedStatus,
                    message:
                        normalizedStatus === "FAILED"
                            ? "Transaction Failed"
                            : normalizedStatus === "PENDING"
                                ? "Transaction Pending"
                                : "Transaction Success",
                    providerMsg: payload.status,
                    transactionId: payload.orderId,
                    providerTransactionId: payload.transactionId,
                    amount: Number(payload.amount || 0),
                    utr: payload.utr || undefined,
                    result: payload,
                };
            }

            // CASE 2: PAYIN WEBHOOK (No decryption)
            if (type === "PAYIN") {
                const normalizedStatus = this.normalizeStatus(payload.status);

                return {
                    type: "payin",
                    success: normalizedStatus === "SUCCESS",
                    status: normalizedStatus,
                    message:
                        normalizedStatus === "FAILED"
                            ? "Transaction Failed"
                            : normalizedStatus === "PENDING"
                                ? "Transaction Pending"
                                : normalizedStatus === "EXPIRED"
                                    ? "Transaction Expired"
                                    : "Transaction Success",
                    providerMsg: payload.status,
                    transactionId: payload.ref_id,
                    amount: payload.amount,
                    utr: payload.utr_number,
                    providerTransactionId: payload.payment_id,
                    result: payload,
                };
            }

            // CASE 3: PAYOUT WEBHOOK (Decryption required)
            const data = this.decryptPayload(payload.payload);
            const normalizedStatus = this.normalizeStatus(data.status);

            return {
                type: "payout",
                success: normalizedStatus === "SUCCESS",
                status: normalizedStatus,
                message:
                    normalizedStatus === "FAILED"
                        ? "Payout Failed from Provider"
                        : normalizedStatus === "PENDING"
                            ? "Payout Pending"
                            : "Payout Success",
                providerMsg: data.status,
                transactionId: data.ref_id,
                amount: data.amount,
                utr: data.utr_number,
                providerTransactionId: data.request_id,
                result: data,
            };
        } catch (err: any) {
            logger.error(`[AlphaPay] Webhook processing failed: ${err.message}`, err);
            return {
                type: "webhook",
                success: false,
                status: "FAILED",
                message: "Webhook handling failed",
                providerMsg: err.message,
                transactionId: '',
                amount: 0,
                error: err,
            };
        }
    }
}
