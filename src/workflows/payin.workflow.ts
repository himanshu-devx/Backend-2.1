import { BasePaymentWorkflow } from "./base-payment.workflow";
import { InitiatePayinDto } from "@/dto/payment/payin.dto";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { TransactionType, TransactionPartyType } from "@/constants/transaction.constant";
import { Forbidden } from "@/utils/error";
import { getISTDate } from "@/utils/date.util";
import { ProviderFactory } from "@/providers/provider-factory";
import { CacheService } from "@/services/common/cache.service";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";
import { PaymentError, PaymentErrorCode, mapToPaymentError } from "@/utils/payment-errors.util";
import { generateCustomId } from "@/utils/id.util";

export class PayinWorkflow extends BasePaymentWorkflow<InitiatePayinDto> {
    private merchantFees: any;
    private providerFees: any;
    private routing: any;
    private channel: any;
    private generatedId!: string;

    protected getWorkflowName(): string { return "PAYIN"; }

    protected shouldPersistBeforeGateway(): boolean {
        return false;
    }

    protected async prepare(dto: InitiatePayinDto): Promise<void> {
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
    }

    protected async validate(dto: InitiatePayinDto): Promise<void> {
        const config = this.merchant.payin;
        if (!config || !config.isActive) {
            throw new PaymentError(PaymentErrorCode.SERVICE_DISABLED);
        }

        // Routing
        this.routing = config.routing;
        if (!this.routing?.providerId) {
            throw new PaymentError(PaymentErrorCode.ROUTING_NOT_CONFIGURED);
        }

        this.channel = await CacheService.getChannel(this.routing.providerId, this.routing.legalEntityId);
        if (!this.channel) {
            throw new PaymentError(PaymentErrorCode.CHANNEL_NOT_FOUND);
        }
        if (!this.channel.isActive) {
            throw new PaymentError(PaymentErrorCode.CHANNEL_INACTIVE);
        }

        // Fees
        this.merchantFees = this.calculateFees(dto.amount, config.fees);
        this.providerFees = this.calculateFees(dto.amount, this.channel.payin.fees);
    }

    protected async persist(dto: InitiatePayinDto, gatewayResult: any): Promise<void> {
        const netAmount = this.round(dto.amount - this.merchantFees.total);

        this.transaction = new TransactionModel({
            id: this.generatedId,
            merchantId: this.merchant.id,
            type: TransactionType.PAYIN,
            amount: dto.amount,
            netAmount: netAmount,
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
            status: TransactionStatus.PENDING,
            fees: { merchantFees: this.merchantFees, providerFees: this.providerFees },
            meta: { ip: this.requestIp },
            events: [
                { type: "WORKFLOW_STARTED", timestamp: getISTDate() },
                { type: "PROVIDER_INITIATED", timestamp: getISTDate(), payload: gatewayResult }
            ],
        });

        await this.transaction.save();
    }

    protected async gatewayCall(dto: InitiatePayinDto): Promise<any> {
        const provider = ProviderFactory.getProvider(this.channel.id);
        const providerRequest = {
            amount: dto.amount,
            transactionId: this.generatedId, // Use pre-generated ID
            customerName: dto.customerName,
            customerEmail: dto.customerEmail,
            customerPhone: dto.customerPhone,
            callbackUrl: `${ENV.APP_BASE_URL || "http://localhost:4000"}/api/webhook/payin/${this.routing.providerId}/${this.routing.legalEntityId}`,
            redirectUrl: dto.redirectUrl,
            remarks: dto.remarks || "Payin",
            company: this.merchant.id
        };

        return provider.handlePayin(providerRequest);
    }

    protected async postExecute(result: any): Promise<void> {
        // In Provider-First mode, persist is called before postExecute if gateway succeeds.
    }

    protected formatResponse(result: any): any {
        return {
            orderId: this.transaction.orderId,
            transactionId: this.generatedId,
            paymentUrl: result.result,
            amount: this.transaction.amount,
            status: "PENDING"
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
