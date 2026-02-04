import crypto from "crypto";
import { TransactionModel, TransactionStatus, TransactionDocument } from "@/models/transaction.model";
import { TransactionEntityType, TransactionPartyType, TransactionType } from "@/constants/transaction.constant";
import { Forbidden, NotFound } from "@/utils/error";
import { redis } from "@/infra/redis-instance";
import { LedgerService } from "@/services/ledger/ledger.service";
import { ACCOUNT_TYPE } from "@/constants/tigerbeetle.constant";
import { CacheService } from "@/services/common/cache.service";
import { AccountManagerService } from "@/services/ledger/account-manager.service";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";

export interface CreateTransactionDto {
    amount: number;
    currency?: string;
    orderId: string;
    customer: {
        name?: string;
        email?: string;
        phone?: string;
        [key: string]: any;
    };
    hash: string;
    redirectUrl?: string;
    remarks?: string;
    [key: string]: any;
}

export class PayinService {

    private validateHash(payload: CreateTransactionDto, apiSecret: string): boolean {
        const { amount, currency = "INR", orderId, hash } = payload;
        const dataString = `${amount}|${currency}|${orderId}|${apiSecret}`;
        const computedHash = crypto.createHmac("sha256", apiSecret).update(dataString).digest("hex");
        return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));
    }

    private round(val: number): number {
        return Math.round((val + Number.EPSILON) * 100) / 100;
    }

    private generateProviderRef(): string {
        return `PRF${Date.now()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    }

    private generateUTR(): string {
        return `UTR${Date.now()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    }

    private calculateFees(amount: number, tiers: any[]) {
        if (!tiers || tiers.length === 0) {
            throw new Error("Fee configuration is missing for this merchant/provider");
        }

        const tier = tiers.find((t) => {
            const to = t.toAmount === -1 ? Infinity : t.toAmount;
            return amount >= t.fromAmount && amount <= to;
        });

        if (!tier) {
            throw new Error("Transaction amount is not within the valid fee tier range (Lower/Upper limits)");
        }

        const { flat, percentage, taxRate } = tier.charge;
        const percentageFee = this.round((amount * percentage) / 100);
        const subTotal = this.round(flat + percentageFee);
        const tax = this.round((subTotal * taxRate) / 100);
        const total = this.round(subTotal + tax);

        return { flat, percentage: percentageFee, tax, total };
    }

    private async checkMerchantConfig(merchantId: string, requestIp: string) {
        const merchant = await CacheService.getMerchant(merchantId);
        if (!merchant) throw NotFound("Merchant not found");
        if (!merchant.status || !merchant.isOnboard) throw Forbidden("Merchant is not active");

        const config = merchant.payin;
        if (!config.isActive) throw Forbidden("Payin service is disabled");

        if (config.isApiIpWhitelistEnabled) {
            // Allow Localhost by default for development convenience
            const isLocal = requestIp === "127.0.0.1" || requestIp === "::1";
            if (!isLocal && (!config.apiIpWhitelist || !config.apiIpWhitelist.includes(requestIp))) {
                throw Forbidden("IP not whitelisted");
            }
        }
        return { merchant, config };
    }

    private async checkLimits(merchantId: string, amount: number, config: any) {
        if (config.minAmount && amount < config.minAmount) throw new Error(`Amount below minimum limit of ${config.minAmount}`);
        if (config.maxAmount && amount > config.maxAmount) throw new Error(`Amount exceeds maximum limit of ${config.maxAmount}`);

        if (config.dailyLimit) {
            const today = getISTDate().toISOString().slice(0, 10);
            const redisKey = `daily_vol:${merchantId}:PAYIN:${today}`;
            const pipe = redis.pipeline();
            pipe.incrby(redisKey, amount);
            pipe.expire(redisKey, 86400, "NX");
            const results = await pipe.exec();
            const currentVol = results?.[0]?.[1] as number;
            if (currentVol > config.dailyLimit) {
                await redis.decrby(redisKey, amount);
                throw new Error("Daily transaction limit exceeded");
            }
        }
    }

    private async checkRouting(config: any) {
        const routing = config.routing;
        if (!routing || !routing.providerId || !routing.legalEntityId) {
            throw new Error("Merchant payin routing is not configured.");
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
        let merchantAccount = await CacheService.getLedgerAccount(merchantId, ACCOUNT_TYPE.MERCHANT_PAYIN.slug);
        if (!merchantAccount) {
            await AccountManagerService.provisionMerchantAccounts(merchantId);
            merchantAccount = await CacheService.getLedgerAccount(merchantId, ACCOUNT_TYPE.MERCHANT_PAYIN.slug);
        }

        let pleAvailableAccount = await CacheService.getLedgerAccount(channelId, ACCOUNT_TYPE.PROVIDER_PAYIN.slug);
        if (!pleAvailableAccount) {
            await AccountManagerService.provisionProviderLegalEntityAccounts(channelId);
            pleAvailableAccount = await CacheService.getLedgerAccount(channelId, ACCOUNT_TYPE.PROVIDER_PAYIN.slug);
        }

        // Fetch Income Account (Assuming fixed ID for now or lookup)
        // Ideally checking CacheService or finding by TypeSlug globally
        // const { LedgerAccountModel } = await import("@/models/ledger-account.model");
        // let incomeAccountDoc = await LedgerAccountModel.findOne({ typeSlug: ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug });

        // if (!incomeAccountDoc) {
        // Auto provision super admin
        // We need an admin ID. For now system fallback or look up an admin.
        // This corresponds to a specific admin ID in the provisioning function.
        // Skipping auto-provision for SA for now as it requires an Admin ID param.
        // But we should at least log or throw clear error.
        // }

        if (!merchantAccount || !pleAvailableAccount) {
            throw new Error(`Ledger accounts (Merchant, PLE, or Income) not initialized. Merchant: ${!!merchantAccount}, PLE: ${!!pleAvailableAccount}`);
        }

        const merchantFees = transaction.fees.merchantFees || { total: 0 };
        const feeAmount = BigInt(Math.round(merchantFees.total * 100));

        // Use pre-calculated Net Amount from Model
        const netAmount = BigInt(Math.round(transaction.netAmount * 100));

        // 1. Credit Merchant with NET Amount
        // PLE Available -> Merchant Available
        const principalTransfer = await LedgerService.createTransfer(
            pleAvailableAccount.accountId,
            merchantAccount.accountId,
            netAmount,
            merchantAccount.currency,
            {
                actorId: "SYSTEM",
                actorType: "SYSTEM",
                reason: "Payin Net Settlement",
                meta: { transactionId: transaction.id }
            }
        );

        // 2. Credit Income with Fees (Directly from PLE)
        // PLE Available -> Income
        // let feeTransfer = null;
        // if (feeAmount > 0n) {
        //     feeTransfer = await LedgerService.createTransfer(
        //         pleAvailableAccount.accountId,
        //         "",
        //         feeAmount,
        //         merchantAccount.currency,
        //         {
        //             actorId: "SYSTEM",
        //             actorType: "SYSTEM",
        //             reason: "Payin Fees",
        //             meta: { transactionId: transaction.id }
        //         }
        //     );
        // }

        transaction.meta.set("transferId", principalTransfer.id.toString());
        // if (feeTransfer) {
        //     transaction.meta.set("feeTransferId", feeTransfer.id.toString());
        // }

        return principalTransfer;
    }

    async createPayin(merchantId: string, data: CreateTransactionDto, requestIp: string): Promise<TransactionDocument> {
        // 1. Merchant Check (Fast Fail - No Transaction yet)
        const { merchant, config } = await this.checkMerchantConfig(merchantId, requestIp);

        // Check for duplicate Order ID
        const existingTxn = await TransactionModel.findOne({
            orderId: data.orderId,
        });

        if (existingTxn) {
            throw Forbidden(`Transaction with Order ID ${data.orderId} already exists.`);
        }

        // Pre-calculate Merchant Fees for Net Amount
        const merchantFees = this.calculateFees(data.amount, config.fees);
        // Payin: Net = Amount - Fees
        const netAmount = this.round(data.amount - merchantFees.total);

        // 2. Create Transaction IMMEDIATELY for Audit Trail
        const transaction = new TransactionModel({
            // Double Entry: Source = Provider Channel (Gateway), Dest = Merchant
            sourceEntityId: "WORLD", // Placeholder until resolved or strictly "EXTERNAL"
            sourceEntityType: TransactionEntityType.WORLD, // It's a user paying

            destinationEntityId: merchant.id,
            destinationEntityType: TransactionEntityType.MERCHANT,

            merchantId: merchant.id,
            // providerId/linkages set later

            type: TransactionType.PAYIN,
            amount: data.amount,
            netAmount: netAmount, // Set required field
            currency: "INR",
            paymentMode: data.paymentMode, // Capture paymentMode from input
            remarks: data.remarks,

            orderId: data.orderId,
            // party replaces customer
            party: {
                type: TransactionPartyType.CUSTOMER,
                name: data.customer?.name,
                email: data.customer?.email,
                phone: data.customer?.phone,
                details: {
                    accountNumber: data.customer?.accountNumber,
                    ifsc: data.customer?.ifsc,
                    bankName: data.customer?.bankName
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

            // Source = Provider Legal Entity (Channel), Dest = Merchant
            transaction.sourceEntityId = channel.id;
            transaction.sourceEntityType = TransactionEntityType.PROVIDER_LEGAL_ENTITY;

            transaction.destinationEntityId = merchant.id;
            transaction.destinationEntityType = TransactionEntityType.MERCHANT;

            // 4. Fees
            // Merchant fees already calculated. Provider fees depend on channel.
            const providerFees = this.calculateFees(data.amount, channel.payin.fees);
            transaction.fees = { merchantFees, providerFees };

            await transaction.save(); // Checkpoint

            // 5. Webhook Trigger / Simulation Mode: Control transaction outcome via remarks
            if (data.remarks) {
                const remarkUpper = data.remarks.toUpperCase();

                if (remarkUpper === "SUCCESS") {
                    // Simulated Success
                    transaction.status = TransactionStatus.SUCCESS;
                    transaction.providerRef = this.generateProviderRef();
                    transaction.utr = this.generateUTR();

                    transaction.meta.set("isWebhookTrigger", true);
                    transaction.events.push({
                        type: "SUCCESS",
                        timestamp: getISTDate(),
                        payload: { mode: "WEBHOOK_TRIGGER", remarks: data.remarks }
                    });

                    // Execute Money Movement for SUCCESS
                    await this.executeMoneyMovement(transaction, merchant.id, channel.id, data.amount, merchantFees);

                    // Event: LEDGER_CREATED
                    transaction.events.push({
                        type: "LEDGER_CREATED",
                        timestamp: getISTDate(),
                        payload: { transferType: "NET_SETTLEMENT" }
                    });

                    // Webhook Event
                    transaction.events.push({
                        type: "WEBHOOK_TRIGGER",
                        timestamp: getISTDate(),
                        payload: { status: TransactionStatus.SUCCESS, utr: transaction.utr, providerRef: transaction.providerRef, message: "Webhook Trigger success" }
                    });

                    await transaction.save();

                    await CacheService.invalidateMerchant(merchant.id);

                    return transaction;

                } else if (remarkUpper === "PENDING") {
                    // Simulated Pending - Create PENDING ledger transfer
                    transaction.providerRef = this.generateProviderRef();

                    // Execute Money Movement with PENDING flag
                    const { TB_TRANSFER_FLAGS } = await import("@/constants/tigerbeetle.constant");

                    let merchantAccount = await CacheService.getLedgerAccount(merchant.id, ACCOUNT_TYPE.MERCHANT_PAYIN.slug);
                    if (!merchantAccount) {
                        await AccountManagerService.provisionMerchantAccounts(merchant.id);
                        merchantAccount = await CacheService.getLedgerAccount(merchant.id, ACCOUNT_TYPE.MERCHANT_PAYIN.slug);
                    }

                    let pleAvailableAccount = await CacheService.getLedgerAccount(channel.id, ACCOUNT_TYPE.PROVIDER_PAYIN.slug);
                    if (!pleAvailableAccount) {
                        await AccountManagerService.provisionProviderLegalEntityAccounts(channel.id);
                        pleAvailableAccount = await CacheService.getLedgerAccount(channel.id, ACCOUNT_TYPE.PROVIDER_PAYIN.slug);
                    }

                    if (!merchantAccount || !pleAvailableAccount) {
                        throw new Error(`Ledger accounts not initialized for PENDING transfer`);
                    }

                    const netAmount = BigInt(Math.round(transaction.netAmount * 100));

                    // Create PENDING transfer
                    const pendingTransfer = await LedgerService.createTransfer(
                        pleAvailableAccount.accountId,
                        merchantAccount.accountId,
                        netAmount,
                        merchantAccount.currency,
                        {
                            actorId: "SYSTEM",
                            actorType: "SYSTEM",
                            reason: "Payin Pending Settlement",
                            meta: { transactionId: transaction.id }
                        },
                        TB_TRANSFER_FLAGS.PENDING
                    );

                    transaction.meta.set("transferId", pendingTransfer.id.toString());
                    transaction.meta.set("ledgerStatus", "PENDING");

                    transaction.events.push({
                        type: "LEDGER_CREATED",
                        timestamp: getISTDate(),
                        payload: { transferType: "NET_SETTLEMENT", status: "PENDING" }
                    });

                    transaction.events.push({
                        type: "PENDING",
                        timestamp: getISTDate(),
                        payload: { mode: "PENDING", remarks: data.remarks }
                    });

                    await transaction.save();
                    return transaction;

                } else {
                    // Simulated Failed - NO ledger transfer
                    transaction.providerRef = this.generateProviderRef();
                    transaction.status = TransactionStatus.FAILED;

                    transaction.meta.set("isWebhookTrigger", true);
                    transaction.events.push({
                        type: "FAILED",
                        timestamp: getISTDate(),
                        payload: { mode: "WEBHOOK_TRIGGER", status: TransactionStatus.FAILED, providerRef: transaction.providerRef, message: "Webhook Trigger failure" }
                    });

                    // Webhook Event
                    transaction.events.push({
                        type: "WEBHOOK_TRIGGER",
                        timestamp: getISTDate(),
                        payload: { status: TransactionStatus.FAILED }
                    });

                    await transaction.save();
                    return transaction;

                }
            }

            // 5. Money Movement (Real Mode - no remark provided)
            await this.executeMoneyMovement(transaction, merchant.id, channel.id, data.amount, merchantFees);

            transaction.status = TransactionStatus.SUCCESS;
            transaction.providerRef = this.generateProviderRef();
            transaction.utr = this.generateUTR();

            // Event: LEDGER_CREATED & SUCCESS
            transaction.events.push({
                type: "LEDGER_CREATED",
                timestamp: getISTDate(),
                payload: { transferType: "NET_SETTLEMENT" }
            });
            transaction.events.push({
                type: "SUCCESS",
                timestamp: getISTDate(),
            });

            // Webhook Event
            transaction.events.push({
                type: "WEBHOOK_TRIGGER",
                timestamp: getISTDate(),
                payload: { status: TransactionStatus.SUCCESS }
            });

            await transaction.save();

            await CacheService.invalidateMerchant(merchant.id);

        } catch (error: any) {
            // Detailed Logging
            logger.error(`Payin Transaction Failed [${transaction.id}]: ${error.message}`);

            transaction.status = TransactionStatus.FAILED;
            transaction.meta.set("error", error.message); // Internal error in meta for admin
            transaction.error = error.message;

            // Auditable Event with REAL Error
            transaction.events.push({
                type: "FAILED",
                timestamp: getISTDate(),
                payload: { error: error.message }
            });

            // Refund Logic (Stub)
            if (transaction.meta.get("transferId")) {
                transaction.events.push({
                    type: "REFUND_NEEDED",
                    timestamp: getISTDate(),
                    payload: { reason: "Partial failure after principal transfer" }
                });
            }

            // Webhook Event
            transaction.events.push({
                type: "WEBHOOK_TRIGGER",
                timestamp: getISTDate(),
                payload: { status: TransactionStatus.FAILED }
            });

            await transaction.save();

            // GENERIC vs SPECIFIC User Errors
            // If the error is related to limits or fees (ranges), we show it to the user.
            if (error.message.includes("minimum limit") ||
                error.message.includes("maximum limit") ||
                error.message.includes("valid fee tier range")) {
                throw Forbidden(error.message);
            }

            // For debugging: Return actual error message
            throw Forbidden(error.message || "Transaction processing failed. Please check configuration or contact support.");
        }

        return transaction;
    }
}

export const payinService = new PayinService();
