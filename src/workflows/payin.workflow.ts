import { BasePaymentWorkflow } from "./base-payment.workflow";
import { InitiatePayinDto } from "@/dto/payment/payin.dto";
import type { PayinInitiateResponse } from "@/services/payment/payment.types";
import type { ProviderPayinResult } from "@/provider-config/types";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { TransactionType, TransactionPartyType } from "@/constants/transaction.constant";
import { Forbidden } from "@/utils/error";
import { getISTDate } from "@/utils/date.util";
import { PaymentRoutingService } from "@/services/payment/payment-routing.service";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";
import { PaymentError, PaymentErrorCode, mapToPaymentError } from "@/utils/payment-errors.util";
import { generateCustomId } from "@/utils/id.util";
import { ProviderClient } from "@/services/provider-config/provider-client.service";
import { TpsService } from "@/services/common/tps.service";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { mapFeeDetailToStorage, toDisplayAmount, toStorageAmount } from "@/utils/money.util";
import { TransactionMonitorService } from "@/services/payment/transaction-monitor.service";
import { redis } from "@/infra/redis-instance";
import { RedisKeys } from "@/constants/redis.constant";

const UPI_INTENT_TTL_SECONDS = 30 * 60;

export class PayinWorkflow extends BasePaymentWorkflow<
    InitiatePayinDto,
    PayinInitiateResponse,
    ProviderPayinResult
> {
    private merchantFees: any;
    private providerFees: any;
    private routing: any;
    private channel: any;
    private channelChain: any[] = [];
    private generatedId!: string;

    protected getWorkflowName(): string { return "PAYIN"; }

    protected shouldPersistBeforeGateway(): boolean {
        return false;
    }

    protected async prepare(dto: InitiatePayinDto): Promise<void> {
        logger.info(
            { orderId: dto.orderId, merchantId: this.merchant.id },
            "[PayinWorkflow] Preparing request"
        );
        // Double spend check
        const existingTxn = await TransactionModel.findOne({
            orderId: dto.orderId,
            merchantId: this.merchant.id
        });
        if (existingTxn) throw Forbidden(`Duplicate Order ID: ${dto.orderId}`);

        // Pre-generate ID for provider reference
        const rawPrefix = ENV.APP_BRAND_PREFIX || ENV.APP_BRAND_NAME || "TXN";
        let prefix = rawPrefix.replace(/[^a-zA-Z]/g, "").substring(0, 4).toUpperCase();
        if (!prefix) prefix = "TXN";

        this.generatedId = await generateCustomId(prefix, "transaction");
        logger.info(
            { orderId: dto.orderId, transactionId: this.generatedId },
            "[PayinWorkflow] Generated transaction ID"
        );
    }

    protected async validate(dto: InitiatePayinDto): Promise<void> {
        const config = this.merchant.payin;
        if (!config || !config.isActive) {
            throw new PaymentError(PaymentErrorCode.SERVICE_DISABLED);
        }

        // Routing (Primary + Fallbacks)
        try {
            this.channelChain = await PaymentRoutingService.getProviderChain(this.merchant.id, "PAYIN");
        } catch (error: any) {
            throw new PaymentError(PaymentErrorCode.CHANNEL_NOT_FOUND, { message: error.message });
        }
        this.channel = this.channelChain[0];
        this.routing = {
            providerId: this.channel.providerId,
            legalEntityId: this.channel.legalEntityId,
        };
        logger.info(
            {
                orderId: dto.orderId,
                transactionId: this.generatedId,
                providerId: this.routing.providerId,
                legalEntityId: this.routing.legalEntityId
            },
            "[PayinWorkflow] Routing resolved"
        );

        // Fees
        this.merchantFees = this.calculateFees(dto.amount, config.fees);
    }

    protected async persist(
        dto: InitiatePayinDto,
        gatewayResult: ProviderPayinResult
    ): Promise<void> {
        const netAmount = this.round(dto.amount - this.merchantFees.total);
        const amountStored = toStorageAmount(dto.amount);
        const netAmountStored = toStorageAmount(netAmount);
        const merchantFeesStored = mapFeeDetailToStorage(this.merchantFees);
        const providerFeesStored = mapFeeDetailToStorage(this.providerFees);

        this.transaction = new TransactionModel({
            id: this.generatedId,
            merchantId: this.merchant.id,
            type: TransactionType.PAYIN,
            amount: amountStored,
            netAmount: netAmountStored,
            currency: "INR",
            paymentMode: dto.paymentMode,
            remarks: dto.remarks,
            orderId: dto.orderId,
            providerId: this.routing.providerId,
            legalEntityId: this.routing.legalEntityId,
            providerLegalEntityId: this.channel.id,
            providerRef: gatewayResult.providerTransactionId,
            party: {
                type: TransactionPartyType.CUSTOMER,
                name: dto.customerName,
                email: dto.customerEmail,
                phone: dto.customerPhone,
            },
            status: (gatewayResult?.status === 'SUCCESS') ? TransactionStatus.SUCCESS : TransactionStatus.PENDING,
            fees: { merchantFees: merchantFeesStored, providerFees: providerFeesStored },
            meta: { ip: this.requestIp },
            events: [
                { type: "WORKFLOW_STARTED", timestamp: getISTDate(), payload: dto },
                { type: "PROVIDER_INITIATED", timestamp: getISTDate(), payload: gatewayResult }
            ],
        });

        await this.transaction.save();
        logger.info(
            {
                orderId: dto.orderId,
                transactionId: this.transaction.id,
                providerId: this.routing.providerId,
                legalEntityId: this.routing.legalEntityId
            },
            "[PayinWorkflow] Transaction persisted"
        );

        if (gatewayResult?.result) {
            try {
                await redis.setex(
                    RedisKeys.PAYIN_INTENT(this.generatedId),
                    UPI_INTENT_TTL_SECONDS,
                    gatewayResult.result
                );
            } catch (error: any) {
                logger.warn(
                    {
                        orderId: dto.orderId,
                        transactionId: this.generatedId,
                        error: error?.message
                    },
                    "[PayinWorkflow] Failed to cache UPI intent"
                );
            }
        }
    }

    protected async gatewayCall(dto: InitiatePayinDto): Promise<ProviderPayinResult> {
        let lastError: any;

        const existingTxn = await TransactionModel.findOne({
            orderId: dto.orderId,
            merchantId: this.merchant.id
        });
        if (existingTxn) {
            throw new PaymentError(PaymentErrorCode.DUPLICATE_ORDER_ID, { orderId: dto.orderId });
        }

        for (const channel of this.channelChain) {
            try {
                this.channel = channel;
                this.routing = {
                    providerId: channel.providerId,
                    legalEntityId: channel.legalEntityId,
                };
                this.providerFees = this.calculateFees(dto.amount, channel.payin.fees);

                // TPS: system + merchant (once) is enforced before first provider call
                if (channel === this.channelChain[0]) {
                    await TpsService.system("PAYIN", ENV.SYSTEM_TPS, ENV.SYSTEM_TPS_WINDOW);
                    await TpsService.merchant(this.merchant.id, "PAYIN", this.merchant.payin?.tps || 0);
                }

                // TPS: provider/PLE level
                await TpsService.ple(channel.id, "PAYIN", channel.payin?.tps || 0);

                const provider = await ProviderClient.getProviderForRouting(
                    channel.providerId,
                    channel.legalEntityId
                );
                logger.info(
                    {
                        orderId: dto.orderId,
                        transactionId: this.generatedId,
                        pleId: channel.id,
                        providerId: channel.providerId,
                        legalEntityId: channel.legalEntityId
                    },
                    "[PayinWorkflow] Calling provider"
                );
                const callbackUrl = await ProviderClient.buildWebhookUrl(
                    "PAYIN",
                    this.routing.providerId,
                    this.routing.legalEntityId
                );

                const providerRequest = {
                    amount: dto.amount,
                    transactionId: this.generatedId, // Use pre-generated ID
                    orderId: dto.orderId,
                    customerName: dto.customerName,
                    customerEmail: dto.customerEmail,
                    customerPhone: dto.customerPhone,
                    paymentMode: dto.paymentMode,
                    callbackUrl,
                    redirectUrl: dto.redirectUrl,
                    remarks: dto.remarks || "Payin",
                    company: this.merchant.id
                };

                const result = await ProviderClient.execute(channel.id, "payin", () =>
                    provider.handlePayin(providerRequest)
                );

                logger.info(
                    {
                        orderId: dto.orderId,
                        transactionId: this.generatedId,
                        providerId: channel.providerId,
                        legalEntityId: channel.legalEntityId,
                        status: result.status,
                        success: result.success
                    },
                    "[PayinWorkflow] Provider response"
                );

                if (!result.success && result.status !== "PENDING") {
                    logger.error(
                        {
                            orderId: dto.orderId,
                            transactionId: this.generatedId,
                            providerId: channel.providerId,
                            legalEntityId: channel.legalEntityId,
                            providerStatus: result.status,
                            providerMessage: result.message,
                            providerResponse: result
                        },
                        "[PayinWorkflow] Provider rejected request"
                    );
                    throw new PaymentError(PaymentErrorCode.PROVIDER_REJECTED, {
                        providerId: channel.providerId,
                        legalEntityId: channel.legalEntityId,
                        providerStatus: result.status,
                        providerMessage: result.message,
                        providerResponse: result,
                    });
                }

                return result;
            } catch (error: any) {
                lastError = error;
                if (!ProviderClient.isRetryableError(error)) {
                    throw mapToPaymentError(error);
                }
                logger.warn(
                    {
                        orderId: dto.orderId,
                        transactionId: this.generatedId,
                        pleId: channel.id,
                        error: error.message
                    },
                    "[PayinWorkflow] Provider failed, trying fallback"
                );
            }
        }

        throw mapToPaymentError(lastError || new Error("Provider unavailable"));
    }

    protected async postExecute(result: ProviderPayinResult): Promise<void> {
        if (result.success && result.status === 'SUCCESS') {
            const entryId = await PaymentLedgerService.processPayinCredit(this.transaction);
            logger.info(
                {
                    orderId: this.transaction.orderId,
                    transactionId: this.transaction.id,
                    ledgerEntryId: entryId
                },
                "[PayinWorkflow] Ledger credited"
                );
        }

        if (this.transaction?.status === TransactionStatus.PENDING) {
            await TransactionMonitorService.schedulePayinExpiry(this.transaction.id);
        }
    }

    protected formatResponse(result: ProviderPayinResult): PayinInitiateResponse {
        return {
            orderId: this.transaction.orderId,
            transactionId: this.generatedId,
            paymentUrl: result.result,
            amount: toDisplayAmount(this.transaction.amount),
            status: this.transaction.status
        };
    }

    private calculateFees(amount: number, tiers: any[]) {
        if (!tiers || tiers.length === 0) throw new Error("Fee config missing");
        const tier = tiers.find(t => amount >= t.fromAmount && (t.toAmount === -1 || amount <= t.toAmount));
        if (!tier) throw new Error("Amount not in fee range");

        const { flat, percentage, taxRate } = tier.charge;
        const percentageFee = this.round((amount * percentage) / 100);
        const subTotal = this.round(flat + percentageFee);
        const tax = this.round((subTotal * taxRate) / 100);
        const total = this.round(subTotal + tax);

        return { flat, percentage: percentageFee, tax, total };
    }
}
