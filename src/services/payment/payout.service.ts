import crypto from "crypto";
import { TransactionModel, TransactionStatus, TransactionDocument } from "@/models/transaction.model";
import { TransactionEntityType, TransactionPartyType, TransactionType } from "@/constants/transaction.constant";
import { Forbidden, NotFound, AppError } from "@/utils/error";
import { redis } from "@/infra/redis-instance";
import { LedgerAccountModel } from "@/models/ledger-account.model";
import { LedgerService, uuidToBigInt } from "@/services/ledger/ledger.service";
import { v4 as uuidv4 } from "uuid";
import { ACCOUNT_TYPE, TB_TRANSFER_FLAGS } from "@/constants/tigerbeetle.constant";
import { CacheService } from "@/services/common/cache.service";
import { AccountManagerService } from "@/services/ledger/account-manager.service";
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

    private async executeMoneyMovement(
        transaction: TransactionDocument,
        merchantId: string,
        channelId: string,
        amount: number,
        fees: any
    ) {
        let merchantAccount = await CacheService.getLedgerAccount(merchantId, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug);
        if (!merchantAccount) {
            // Auto-provision if missing
            await AccountManagerService.provisionMerchantAccounts(merchantId);
            merchantAccount = await CacheService.getLedgerAccount(merchantId, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug);
        }

        let pleAvailableAccount = await CacheService.getLedgerAccount(channelId, ACCOUNT_TYPE.PROVIDER_PAYOUT.slug);
        if (!pleAvailableAccount) {
            // Auto-provision if missing (PLE logic might need channel provider/LE IDs, but here we only have channelId (PLE ID))
            await AccountManagerService.provisionProviderLegalEntityAccounts(channelId);
            pleAvailableAccount = await CacheService.getLedgerAccount(channelId, ACCOUNT_TYPE.PROVIDER_PAYOUT.slug);
        }

        if (!merchantAccount || !pleAvailableAccount) {
            throw new Error(`Ledger accounts (Merchant or PLE) not initialized. Merchant: ${!!merchantAccount}, PLE: ${!!pleAvailableAccount}`);
        }

        // Use pre-calculated Net Amount (Gross Deduction) from Model
        const grossAmount = BigInt(Math.round(transaction.netAmount * 100));

        // 1. Debit Merchant for Gross Amount (Send to PLE)
        // Immediate transfer (no pending flag)
        const principalTransfer = await LedgerService.createTransfer(
            merchantAccount.accountId,
            pleAvailableAccount.accountId,
            grossAmount,
            merchantAccount.currency,
            {
                actorId: "SYSTEM",
                actorType: "SYSTEM",
                reason: "Payout Gross Deduction",
                meta: { transactionId: transaction.id }
            }
            // No PENDING flag - immediate transfer
        );

        transaction.meta.set("transferId", principalTransfer.id.toString());
        // Fee transfer logic removed. Fees are part of Gross Amount moving to PLE.

        return principalTransfer;
    }

    /**
     * Internal helper to create a Payout Transfer
     * @deprecated use split transfer logic in createPayout
     */
    private async createPayoutTransfer(
        merchantAccount: any,
        pleAccount: any,
        amount: bigint,
        currency: number
    ) {
        return LedgerService.createTransfer(
            merchantAccount.accountId,
            pleAccount.accountId,
            amount,
            currency,
            { actorId: "SYSTEM", actorType: "SYSTEM", reason: "Payout" },
            TB_TRANSFER_FLAGS.PENDING
        );
    }

    /**
     * Refund a Payout Transaction
     * - For PENDING transfers: Voids the pending transfer
     * - For SUCCESS/POSTED transfers: Creates a reversal transfer
     */
    async refundPayout(transaction: TransactionDocument, reason?: string): Promise<TransactionDocument> {
        if (transaction.type !== TransactionType.PAYOUT) {
            throw new Error("Refund is only supported for PAYOUT transactions");
        }

        if (transaction.status === TransactionStatus.FAILED) {
            throw new Error("Cannot refund a failed transaction");
        }

        const principalId = transaction.meta.get("principalTransferId");
        const feeId = transaction.meta.get("feeTransferId");
        const ledgerStatus = transaction.meta.get("ledgerStatus");

        // Case 1: PENDING transfers - Void them
        if (ledgerStatus === "PENDING" || transaction.status === TransactionStatus.PENDING) {
            if (principalId) await LedgerService.voidTransfer(principalId);
            if (feeId) await LedgerService.voidTransfer(feeId);

            transaction.status = TransactionStatus.FAILED;
            transaction.meta.set("ledgerStatus", "VOIDED");
            transaction.meta.set("refundReason", reason || "Refund requested");

            transaction.events.push({
                type: "REFUND",
                timestamp: getISTDate(),
                payload: {
                    action: "VOIDED_PENDING_TRANSFERS",
                    reason: reason || "Refund requested",
                    principalId,
                    feeId
                }
            });

            await transaction.save();

            if (transaction.merchantId) {
                await CacheService.invalidateMerchant(transaction.merchantId);
            }

            return transaction;
        }

        // Case 2: SUCCESS/POSTED transfers - Create reversals
        if (ledgerStatus === "POSTED" || transaction.status === TransactionStatus.SUCCESS) {
            if (!transaction.merchantId || !transaction.providerLegalEntityId) {
                throw new Error("Transaction missing merchantId or providerLegalEntityId");
            }

            // Get account details
            const merchantAccount = await CacheService.getLedgerAccount(
                transaction.merchantId,
                ACCOUNT_TYPE.MERCHANT_PAYOUT.slug
            );
            const pleAccount = await CacheService.getLedgerAccount(
                transaction.providerLegalEntityId!,
                ACCOUNT_TYPE.PROVIDER_PAYOUT.slug
            );
            const adminIncomeAccount = await LedgerAccountModel.findOne({ typeSlug: ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug });

            if (!merchantAccount || !pleAccount || !adminIncomeAccount) {
                throw new Error("Cannot find ledger accounts for refund");
            }

            const principalAmount = BigInt(Math.round(transaction.amount * 100));
            const merchantFees = BigInt(Math.round((transaction.fees?.merchantFees?.total || 0) * 100));

            // Create reversal transfers in a batch
            const reversals = await LedgerService.createTransfers([
                {
                    debitAccountId: pleAccount.accountId,
                    creditAccountId: merchantAccount.accountId,
                    amount: principalAmount,
                    code: merchantAccount.currency,
                },
                {
                    debitAccountId: adminIncomeAccount.accountId,
                    creditAccountId: merchantAccount.accountId,
                    amount: merchantFees,
                    code: merchantAccount.currency,
                }
            ]);

            transaction.status = TransactionStatus.FAILED; // Or a specific REFUNDED status if we add one
            transaction.meta.set("refundPrincipalTransferId", reversals[0].id.toString());
            transaction.meta.set("refundFeeTransferId", reversals[1].id.toString());
            transaction.meta.set("refundReason", reason || "Refund requested");
            transaction.meta.set("ledgerStatus", "REFUNDED");

            transaction.events.push({
                type: "REFUND",
                timestamp: getISTDate(),
                payload: {
                    action: "REVERSAL_TRANSFERS_CREATED",
                    reason: reason || "Refund requested",
                    originalPrincipalId: principalId,
                    originalFeeId: feeId,
                    refundPrincipalId: reversals[0].id.toString(),
                    refundFeeId: reversals[1].id.toString()
                }
            });

            await transaction.save();
            await CacheService.invalidateMerchant(transaction.merchantId);

            return transaction;
        }

        throw new Error(`Cannot refund transaction with ledger status: ${ledgerStatus}`);
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
            // Double Entry: Source = Merchant, Dest = External User/Beneficiary
            sourceEntityId: merchant.id,
            sourceEntityType: TransactionEntityType.MERCHANT,

            destinationEntityId: "WORLD", // Placeholder
            destinationEntityType: TransactionEntityType.WORLD,

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
                details: {
                    accountNumber: data.beneficiary?.accountNumber,
                    ifsc: data.beneficiary?.ifsc,
                    bankName: data.beneficiary?.bankName
                }
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

            // Double Entry: Source = Merchant -> Dest = Provider Legal Entity (Channel)
            // Represents Merchant Debit and PLE Credit (Spending from PLE).
            transaction.sourceEntityId = merchant.id;
            transaction.sourceEntityType = TransactionEntityType.MERCHANT;

            transaction.destinationEntityId = channel.id;
            transaction.destinationEntityType = TransactionEntityType.PROVIDER_LEGAL_ENTITY; // Corrected to PLE

            // 4. Fees
            // Merchant fees calculated. Provider fees depend on channel.
            const providerFees = this.calculateFees(data.amount, channel.payout.fees);
            transaction.fees = { merchantFees, providerFees };

            await transaction.save(); // Checkpoint

            // 5. Create PENDING TigerBeetle Transfer (Reserve Funds)
            const { TB_TRANSFER_FLAGS } = await import("@/constants/tigerbeetle.constant");

            let merchantAccount = await CacheService.getLedgerAccount(merchant.id, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug);
            if (!merchantAccount) {
                await AccountManagerService.provisionMerchantAccounts(merchant.id);
                merchantAccount = await CacheService.getLedgerAccount(merchant.id, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug);
            }

            let pleAvailableAccount = await CacheService.getLedgerAccount(channel.id, ACCOUNT_TYPE.PROVIDER_PAYOUT.slug);
            if (!pleAvailableAccount) {
                await AccountManagerService.provisionProviderLegalEntityAccounts(channel.id);
                pleAvailableAccount = await CacheService.getLedgerAccount(channel.id, ACCOUNT_TYPE.PROVIDER_PAYOUT.slug);
            }

            if (!merchantAccount || !pleAvailableAccount) {
                throw new Error(`Ledger accounts not initialized for payout`);
            }

            const principalAmountPaisa = BigInt(Math.round(transaction.amount * 100));
            const merchantFeesPaisa = BigInt(Math.round((transaction.fees?.merchantFees?.total || 0) * 100));

            // Get Admin Income Account
            let adminIncomeAccount = await LedgerAccountModel.findOne({ typeSlug: ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug });
            if (!adminIncomeAccount) {
                // Provision a default one if missing (using "SYSTEM" as ownerId)
                await AccountManagerService.provisionSuperAdminAccount("SYSTEM");
                adminIncomeAccount = await LedgerAccountModel.findOne({ typeSlug: ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug });
            }

            if (!adminIncomeAccount) {
                throw new Error(`Super Admin Income account not found`);
            }

            // Create TWO PENDING transfers in a batch
            const principalTransferId = BigInt(uuidToBigInt(uuidv4()));
            const feeTransferId = BigInt(uuidToBigInt(uuidv4()));

            const transfers = await LedgerService.createTransfers([
                {
                    debitAccountId: merchantAccount.accountId,
                    creditAccountId: pleAvailableAccount.accountId,
                    amount: principalAmountPaisa,
                    code: merchantAccount.currency,
                    flags: TB_TRANSFER_FLAGS.PENDING
                },
                {
                    debitAccountId: merchantAccount.accountId,
                    creditAccountId: adminIncomeAccount.accountId,
                    amount: merchantFeesPaisa,
                    code: merchantAccount.currency,
                    flags: TB_TRANSFER_FLAGS.PENDING
                }
            ]);

            // Note: createTransfers returns the batch. We need to store both IDs.
            transaction.meta.set("principalTransferId", transfers[0].id.toString());
            transaction.meta.set("feeTransferId", transfers[1].id.toString());
            transaction.meta.set("ledgerStatus", "PENDING");

            transaction.events.push({
                type: "LEDGER_CREATED",
                timestamp: getISTDate(),
                payload: {
                    principalTransferId: transfers[0].id.toString(),
                    feeTransferId: transfers[1].id.toString(),
                    status: "PENDING"
                }
            });

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
                    // Immediate success - post both transfers
                    const principalId = transaction.meta.get("principalTransferId");
                    const feeId = transaction.meta.get("feeTransferId");

                    if (principalId) await LedgerService.postTransfer(principalId);
                    if (feeId) await LedgerService.postTransfer(feeId);

                    transaction.meta.set("ledgerStatus", "POSTED");
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

                    transaction.events.push({
                        type: "LEDGER_POSTED",
                        timestamp: getISTDate(),
                        payload: { principalTransferId: principalId, feeTransferId: feeId }
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
                    // Provider failed - void both transfers
                    const principalId = transaction.meta.get("principalTransferId");
                    const feeId = transaction.meta.get("feeTransferId");

                    if (principalId) await LedgerService.voidTransfer(principalId);
                    if (feeId) await LedgerService.voidTransfer(feeId);

                    transaction.meta.set("ledgerStatus", "VOIDED");
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

                    transaction.events.push({
                        type: "LEDGER_VOIDED",
                        timestamp: getISTDate(),
                        payload: { principalTransferId: principalId, feeTransferId: feeId }
                    });
                }

                await transaction.save();
                await CacheService.invalidateMerchant(merchant.id);
                return transaction;

            } catch (providerError: any) {
                logger.error(`[PayoutService] Provider call failed: ${providerError.message}`);

                const principalId = transaction.meta.get("principalTransferId");
                const feeId = transaction.meta.get("feeTransferId");

                if (principalId) await LedgerService.voidTransfer(principalId);
                if (feeId) await LedgerService.voidTransfer(feeId);

                transaction.meta.set("ledgerStatus", "VOIDED");
                transaction.status = TransactionStatus.FAILED;
                transaction.meta.set("error", providerError.message || "Provider communication failed");
                transaction.error = providerError.message || "Provider communication failed";

                transaction.events.push({
                    type: "PROVIDER_ERROR",
                    timestamp: getISTDate(),
                    payload: { message: providerError.message }
                });

                transaction.events.push({
                    type: "LEDGER_VOIDED",
                    timestamp: getISTDate(),
                    payload: { principalTransferId: principalId, feeTransferId: feeId }
                });

                await transaction.save();
                await CacheService.invalidateMerchant(merchant.id);
                throw new AppError(providerError.message || "Payout provider failed");
            }


        } catch (error: any) {
            // Determine user-friendly error message
            let userFriendlyError = error.message;

            if (error.message?.includes("TigerBeetle Transfer Error")) {
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

    async postPayoutTransfer(transaction: any) {
        const principalId = transaction.meta.get("principalTransferId");
        const feeId = transaction.meta.get("feeTransferId");

        if (principalId) await LedgerService.postTransfer(principalId);
        if (feeId) await LedgerService.postTransfer(feeId);

        transaction.meta.set("ledgerStatus", "POSTED");
    }

    async voidPayoutTransfer(transaction: any) {
        const principalId = transaction.meta.get("principalTransferId");
        const feeId = transaction.meta.get("feeTransferId");

        if (principalId) await LedgerService.voidTransfer(principalId);
        if (feeId) await LedgerService.voidTransfer(feeId);

        transaction.meta.set("ledgerStatus", "VOIDED");
    }
}

export const payoutService = new PayoutService();
