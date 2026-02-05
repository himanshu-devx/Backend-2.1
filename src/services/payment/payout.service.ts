import crypto from "crypto";
import { TransactionModel, TransactionStatus, TransactionDocument } from "@/models/transaction.model";
import { TransactionPartyType, TransactionType } from "@/constants/transaction.constant";
import { Forbidden, NotFound, AppError } from "@/utils/error";

import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";

export interface CreateTransactionDto {
    amount: number;
    currency?: string;
    orderId: string;
    beneficiary: {
        name: string;
        email?: string;
        phone?: string;
        accountNumber: string;
        ifsc: string;
        bankName: string;
        [key: string]: any;
    };
    hash: string;
    remarks?: string;
    [key: string]: any;
}

export class PayoutService {
    private round(val: number): number {
        return Math.round((val + Number.EPSILON) * 100) / 100;
    }

    private generateProviderRef(): string {
        return `PRF${Date.now()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    }

    private generateUTR(): string {
        return `UTR${Date.now()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    }

    /**
     * calculateFees
     */
    private calculateFees(amount: number, feesConfig: any[]) {
        let breakdown = { flat: 0, percentage: 0, tax: 0, total: 0 };

        if (!feesConfig || feesConfig.length === 0) return breakdown;

        const slab = feesConfig.find((f: any) => {
            const from = f.fromAmount;
            const to = f.toAmount === -1 ? Infinity : f.toAmount;
            return amount >= from && amount <= to;
        });

        if (slab) {
            const charge = slab.charge;
            breakdown.flat = charge.flat || 0;
            breakdown.percentage = this.round((amount * (charge.percentage || 0)) / 100);
            const subTotal = this.round(breakdown.flat + breakdown.percentage);
            breakdown.tax = this.round((subTotal * (charge.taxRate || 0)) / 100);
            breakdown.total = this.round(subTotal + breakdown.tax);
        }
        return breakdown;
    }



    private async checkMerchantConfig(merchantId: string, requestIp: string) {
        const merchant = await CacheService.getMerchant(merchantId);
        if (!merchant) throw new Error("Merchant not found");

        // IP Whitelist Check
        if (merchant.payout?.isApiIpWhitelistEnabled) {
            const ips = merchant.payout.apiIpWhitelist || [];
            // Allow Localhost by default
            const isLocal = requestIp === "127.0.0.1" || requestIp === "::1";
            if (!isLocal && !ips.includes(requestIp)) throw new Error("IP not whitelisted for Payout");
        }

        if (!merchant.payout?.isActive) throw new Error("Payout is not active for this merchant");

        return { merchant, config: merchant.payout };
    }

    private async checkLimits(merchantId: string, amount: number, config: any) {
        if (config.minAmount && amount < config.minAmount) throw new Error(`Amount less than minimum ${config.minAmount}`);
        if (config.maxAmount && amount > config.maxAmount) throw new Error(`Amount greater than maximum ${config.maxAmount}`);
    }

    private async checkRouting(config: any) {
        const routing = config.routing;
        if (!routing || !routing.providerId || !routing.legalEntityId) {
            throw new Error("Payout routing configuration missing");
        }

        const channel = await CacheService.getChannel(routing.providerId, routing.legalEntityId);
        if (!channel) throw new Error("Active payment channel not found.");
        if (!channel.isActive) throw new Error("Payment channel is currently inactive.");

        return { routing, channel };
    }


    async createPayout(merchantId: string, data: CreateTransactionDto, requestIp: string): Promise<TransactionDocument> {
        // 1. Merchant Check
        const { merchant, config } = await this.checkMerchantConfig(merchantId, requestIp);

        // Pre-calculate Merchant Fees for Net Amount
        const merchantFees = this.calculateFees(data.amount, config.fees);
        // Payout: Net = Amount + Fees (Gross Deduction)
        const netAmount = this.round(data.amount + merchantFees.total);

        // 2. Create Transaction IMMEDIATELY for Audit Trail
        // Check for duplicate Order ID
        const existingTxn = await TransactionModel.findOne({
            orderId: data.orderId,

        });
        if (existingTxn) {
            throw new Error(`Duplicate orderId: ${data.orderId}`);
        }
        const transaction = new TransactionModel({
            merchantId: merchant.id,
            type: TransactionType.PAYOUT,
            amount: data.amount,
            netAmount: netAmount, // Set required field
            currency: "INR",
            paymentMode: data.paymentMode,
            remarks: data.remarks,

            orderId: data.orderId,
            party: {
                type: TransactionPartyType.BENEFICIARY,
                name: data.beneficiary?.name,
                email: data.beneficiary?.email,
                phone: data.beneficiary?.phone,
                accountNumber: data.beneficiary?.accountNumber,
                ifsc: data.beneficiary?.ifsc,
                bankName: data.beneficiary?.bankName
            },
            hash: data.hash,
            meta: {
                hash: data.hash,
                ip: requestIp,
            },

            fees: { merchantFees }, // Set known fees

            status: TransactionStatus.PENDING,
            events: [{
                type: "CREATED",
                timestamp: getISTDate(),
                payload: { amount: data.amount, currency: "INR" }
            }],
        });
        await transaction.save();

        try {
            // 3. Validations & Routing
            await this.checkLimits(merchantId, data.amount, config);

            const { routing, channel } = await this.checkRouting(config);

            // Allow Updating Transaction with Routing Info
            transaction.providerId = routing.providerId;
            transaction.legalEntityId = routing.legalEntityId;
            transaction.providerLegalEntityId = channel.id;

            // 4. Fees
            // Merchant fees calculated. Provider fees depend on channel.
            const providerFees = this.calculateFees(data.amount, channel.payout.fees);
            transaction.fees = { merchantFees, providerFees };


            await transaction.save();

            // 6. Hit AlphaPay Provider
            const { PaymentRoutingService } = await import("@/services/payment/payment-routing.service");
            const { ProviderFactory } = await import("@/providers/provider-factory");

            try {
                // Get provider instance
                const pleId = channel.id; // We already have the PLE ID from routing
                const provider = ProviderFactory.getProvider(pleId);

                // Prepare provider request
                const providerRequest = {
                    amount: data.amount,
                    transactionId: transaction.id,
                    beneficiaryName: data.beneficiary.name,
                    beneficiaryAccountNumber: data.beneficiary.accountNumber,
                    beneficiaryBankIfsc: data.beneficiary.ifsc,
                    beneficiaryBankName: data.beneficiary.bankName,
                    beneficiaryAddress: data.beneficiary.address || "",
                    mode: data.paymentMode || "IMPS",
                    remarks: data.remarks || "Payout",
                };

                // Call provider
                transaction.events.push({
                    type: "PROVIDER_REQUEST",
                    timestamp: getISTDate(),
                    payload: providerRequest
                });
                await transaction.save();

                const providerResponse = await provider.handlePayout(providerRequest);

                // 7. Update transaction with provider response
                transaction.providerRef = providerResponse.providerTransactionId || this.generateProviderRef();

                if (providerResponse.status === 'SUCCESS') {

                    transaction.status = TransactionStatus.SUCCESS;
                    transaction.utr = providerResponse.utr || this.generateUTR();

                    transaction.events.push({
                        type: "PROVIDER_RESPONSE",
                        timestamp: getISTDate(),
                        payload: {
                            status: "SUCCESS",
                            providerRef: transaction.providerRef,
                            utr: transaction.utr,
                            message: providerResponse.message
                        }
                    });

                } else if (providerResponse.status === 'PENDING') {
                    // Provider accepted but pending - keep transfers pending
                    transaction.status = TransactionStatus.PENDING;

                    transaction.events.push({
                        type: "PROVIDER_RESPONSE",
                        timestamp: getISTDate(),
                        payload: {
                            status: "PENDING",
                            providerRef: transaction.providerRef,
                            message: providerResponse.message
                        }
                    });

                } else {

                    transaction.status = TransactionStatus.FAILED;
                    transaction.meta.set("error", providerResponse.message || "Provider rejected payout");
                    transaction.error = providerResponse.message || "Provider rejected payout";

                    transaction.events.push({
                        type: "PROVIDER_RESPONSE",
                        timestamp: getISTDate(),
                        payload: {
                            status: "FAILED",
                            providerRef: transaction.providerRef,
                            message: providerResponse.message
                        }
                    });
                }

                await transaction.save();
                await CacheService.invalidateMerchant(merchant.id);
                return transaction;

            } catch (providerError: any) {
                logger.error(`[PayoutService] Provider call failed: ${providerError.message}`);


                transaction.meta.set("ledgerStatus", "VOIDED");
                transaction.status = TransactionStatus.FAILED;
                transaction.meta.set("error", providerError.message || "Provider communication failed");
                transaction.error = providerError.message || "Provider communication failed";

                transaction.events.push({
                    type: "PROVIDER_ERROR",
                    timestamp: getISTDate(),
                    payload: { message: providerError.message }
                });

                await transaction.save();
                await CacheService.invalidateMerchant(merchant.id);
                throw new AppError(providerError.message || "Payout provider failed");
            }


        } catch (error: any) {
            // Determine user-friendly error message
            let userFriendlyError = error.message;

            if (error.message?.includes("Ledger Transfer Error")) {
                if (error.message.includes("(46)") || error.message.includes("(47)")) {
                    userFriendlyError = "Insufficient funds in payout account";
                } else {
                    userFriendlyError = "Transaction processing failed. Please try again or contact support.";
                }
            }

            // Handle Failures - save user-friendly error
            transaction.status = TransactionStatus.FAILED;
            transaction.meta.set("error", userFriendlyError);
            transaction.error = userFriendlyError;
            transaction.events.push({
                type: "FAILED",
                timestamp: getISTDate(),
                payload: { error: userFriendlyError }
            });

            await transaction.save();
            throw new AppError(userFriendlyError);
        }
    }
}

export const payoutService = new PayoutService();
