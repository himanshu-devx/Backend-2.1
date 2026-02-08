import { BasePaymentWorkflow } from "./base-payment.workflow";
import { InitiatePayoutDto } from "@/dto/payment/payout.dto";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { TransactionType, TransactionPartyType } from "@/constants/transaction.constant";
import { Forbidden } from "@/utils/error";
import { getISTDate } from "@/utils/date.util";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { LedgerService } from "@/services/ledger/ledger.service";
import { LedgerUtils } from "@/utils/ledger.utils";
import { ENTITY_TYPE, ENTITY_ACCOUNT_TYPE } from "@/constants/ledger.constant";
import { AccountType } from "fintech-ledger";
import { PaymentError, PaymentErrorCode, mapToPaymentError } from "@/utils/payment-errors.util";
import { PaymentRoutingService } from "@/services/payment/payment-routing.service";
import { ProviderClient } from "@/services/provider/provider-client.service";
import { TpsService } from "@/services/common/tps.service";
import { ENV } from "@/config/env";

export class PayoutWorkflow extends BasePaymentWorkflow<InitiatePayoutDto> {
    private merchantFees: any;
    private providerFees: any;
    private routing: any;
    private channel: any;
    private channelChain: any[] = [];

    protected getWorkflowName(): string { return "PAYOUT"; }

    protected async prepare(dto: InitiatePayoutDto): Promise<void> {
        const existingTxn = await TransactionModel.findOne({ orderId: dto.orderId, merchantId: this.merchant.id });
        if (existingTxn) {
            throw new PaymentError(PaymentErrorCode.DUPLICATE_ORDER_ID, { orderId: dto.orderId });
        }
    }

    protected async validate(dto: InitiatePayoutDto): Promise<void> {
        const config = this.merchant.payout;
        if (!config || !config.isActive) {
            throw new PaymentError(PaymentErrorCode.SERVICE_DISABLED);
        }

        try {
            this.channelChain = await PaymentRoutingService.getProviderChain(this.merchant.id, "PAYOUT");
        } catch (error: any) {
            throw new PaymentError(PaymentErrorCode.CHANNEL_NOT_FOUND, { message: error.message });
        }
        this.channel = this.channelChain[0];
        this.routing = {
            providerId: this.channel.providerId,
            legalEntityId: this.channel.legalEntityId,
        };

        this.merchantFees = this.calculateFees(dto.amount, config.fees);
        this.providerFees = this.calculateFees(dto.amount, this.channel.payout.fees);

        // TPS: system + merchant (once) before first provider call
        await TpsService.system("PAYOUT", ENV.SYSTEM_TPS, ENV.SYSTEM_TPS_WINDOW);
        await TpsService.merchant(this.merchant.id, "PAYOUT", config.tps || 0);
    }

    protected async persist(dto: InitiatePayoutDto, gatewayResult?: any): Promise<void> {
        const netAmount = this.round(dto.amount + this.merchantFees.total);

        this.transaction = new TransactionModel({
            merchantId: this.merchant.id,
            type: TransactionType.PAYOUT,
            amount: dto.amount,
            netAmount: netAmount,
            currency: "INR",
            paymentMode: dto.paymentMode,
            remarks: dto.remarks,
            orderId: dto.orderId,
            providerId: this.routing.providerId,
            legalEntityId: this.routing.legalEntityId,
            providerLegalEntityId: this.channel.id,
            party: {
                type: TransactionPartyType.BENEFICIARY,
                name: dto.beneficiaryName,
                accountNumber: dto.beneficiaryAccountNumber,
                ifscCode: dto.beneficiaryIfsc,
                bankName: dto.beneficiaryBankName,
            },
            status: TransactionStatus.PENDING,
            fees: { merchantFees: this.merchantFees, providerFees: this.providerFees },
            meta: { ip: this.requestIp },
            events: [{ type: "WORKFLOW_STARTED", timestamp: getISTDate() }],
        });

        await this.transaction.save();
    }

    protected async preExecute(dto: InitiatePayoutDto): Promise<void> {
        try {
            // LEDGER HOLD
            const sourceId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, this.merchant.id, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.PAYIN);
            const destinationId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, this.merchant.id, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.HOLD);

            const holdEntryId = await LedgerService.transfer({
                narration: `Payout: ${this.transaction.orderId}`,
                externalRef: this.transaction.id,
                valueDate: getISTDate(),
                debits: [{ accountId: sourceId, amount: this.transaction.netAmount as any }],
                credits: [{ accountId: destinationId, amount: this.transaction.netAmount as any }],
                status: "PENDING"
            });

            this.transaction.meta.set("ledgerHoldEntryId", holdEntryId);
            await this.transaction.save();
        } catch (error: any) {
            throw new PaymentError(PaymentErrorCode.LEDGER_HOLD_FAILED, {
                originalError: error.message
            });
        }
    }

    protected async gatewayCall(dto: InitiatePayoutDto): Promise<any> {
        let lastError: any;

        for (const channel of this.channelChain) {
            try {
                if (channel.id !== this.channel.id) {
                    this.channel = channel;
                    this.routing = {
                        providerId: channel.providerId,
                        legalEntityId: channel.legalEntityId,
                    };
                    this.providerFees = this.calculateFees(dto.amount, channel.payout.fees);

                    this.transaction.providerId = this.routing.providerId;
                    this.transaction.legalEntityId = this.routing.legalEntityId;
                    this.transaction.providerLegalEntityId = channel.id;
                    this.transaction.fees = { merchantFees: this.merchantFees, providerFees: this.providerFees };
                    await this.transaction.save();
                }

                const provider = ProviderClient.getProvider(channel.id);

                // TPS: provider/PLE level
                await TpsService.ple(channel.id, "PAYOUT", channel.payout?.tps || 0);
                const providerRequest = {
                    amount: dto.amount,
                    transactionId: this.transaction.id,
                    beneficiaryName: dto.beneficiaryName,
                    beneficiaryAccountNumber: dto.beneficiaryAccountNumber,
                    beneficiaryBankIfsc: dto.beneficiaryIfsc,
                    beneficiaryBankName: dto.beneficiaryBankName,
                    mode: dto.paymentMode,
                    remarks: dto.remarks || "Payout",
                };

                const result = await ProviderClient.execute(channel.id, "payout", () =>
                    provider.handlePayout(providerRequest)
                );
                if (!result.success) {
                    throw new PaymentError(PaymentErrorCode.PROVIDER_REJECTED, {
                        providerMessage: result.message
                    });
                }
                return result;
            } catch (error: any) {
                lastError = error;
                if (!ProviderClient.isRetryableError(error)) {
                    throw mapToPaymentError(error);
                }
                logger.warn(`[PayoutWorkflow] Provider ${channel.id} failed, trying fallback...`);
            }
        }

        throw mapToPaymentError(lastError || new Error("Provider unavailable"));
    }

    protected async postExecute(result: any): Promise<void> {
        if (result.success) {
            this.transaction.providerRef = result.providerTransactionId;
            this.transaction.status = result.status as any;
            this.transaction.utr = result.utr;
            this.transaction.events.push({ type: "PROVIDER_INITIATED", timestamp: getISTDate(), payload: result });

            if (this.transaction.status === TransactionStatus.SUCCESS) {
                const entryId = await PaymentLedgerService.commitPayout(this.transaction);
                this.transaction.meta.set("ledgerCommitEntryId", entryId);
            }
            await this.transaction.save();
        } else {
            throw new Error(result.message || "Provider payout failed");
        }
    }

    protected async handleFailure(error: any): Promise<void> {
        // Standard failure logic first
        await super.handleFailure(error);

        // Payout specific: Rollback if hold was created
        if (this.transaction && this.transaction.meta.get("ledgerHoldEntryId") && !this.transaction.meta.get("ledgerRollbackEntryId")) {
            const entryId = await PaymentLedgerService.rollbackPayout(this.transaction);
            this.transaction.meta.set("ledgerRollbackEntryId", entryId);
            await this.transaction.save();
        }
    }

    protected formatResponse(result: any): any {
        return {
            transactionId: this.transaction.id,
            orderId: this.transaction.orderId,
            status: this.transaction.status,
            utr: this.transaction.utr
        };
    }



    private calculateFees(amount: number, tiers: any[]) {
        if (!tiers || tiers.length === 0) {
            throw new PaymentError(PaymentErrorCode.FEE_CONFIG_MISSING);
        }

        const tier = tiers.find(t => amount >= t.fromAmount && (t.toAmount === -1 || amount <= t.toAmount));
        if (!tier) {
            throw new PaymentError(PaymentErrorCode.AMOUNT_ABOVE_MAXIMUM, {
                amount,
                availableTiers: tiers.map(t => ({ min: t.fromAmount, max: t.toAmount }))
            });
        }

        const { flat, percentage, taxRate } = tier.charge;
        const percentageFee = this.round((amount * percentage) / 100);
        const subTotal = this.round(flat + percentageFee);
        const tax = this.round((subTotal * taxRate) / 100);
        const total = this.round(subTotal + tax);

        return { flat, percentage: percentageFee, tax, total };
    }
}
