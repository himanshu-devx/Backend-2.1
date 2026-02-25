import { TransactionModel, TransactionDocument, TransactionStatus } from "@/models/transaction.model";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { AppError } from "@/utils/error";
import { MerchantCallbackService } from "@/services/payment/merchant-callback.service";

export abstract class BasePaymentWorkflow<
    T_DTO,
    T_RES = any,
    T_GATEWAY = any
> {
    protected merchant: any;
    protected requestIp: string;
    protected transaction!: TransactionDocument;
    private currentStepIndex: number = -1;
    private currentSteps: string[] = [];

    constructor(merchant: any, requestIp: string) {
        this.merchant = merchant;
        this.requestIp = requestIp;
    }

    /**
     * Main Execution Template
     */
    async execute(dto: T_DTO): Promise<T_RES> {
        this.currentSteps = this.buildStepList();
        try {
            logger.info(
                {
                    event: "payment.workflow.start",
                    component: "payment",
                    workflow: this.getWorkflowName(),
                    merchantId: this.merchant.id,
                },
                `[Workflow] Starting ${this.getWorkflowName()} for merchant ${this.merchant.id}`
            );

            // 1. Initial Checks & Context
            this.logStep(0, dto);
            await this.prepare(dto);

            // 2. Business Validations (Limits, Routing, Fees)
            this.logStep(1, dto);
            await this.validate(dto);

            let result: any;

            if (this.shouldPersistBeforeGateway()) {
                // DB-First (Payout)
                this.logStep(2, dto);
                await this.persist(dto);
                this.logStep(3, dto);
                await this.preExecute(dto);
                this.logStep(4, dto);
                result = await this.gatewayCall(dto);
            } else {
                // Provider-First (Payin)
                this.logStep(2, dto);
                result = await this.gatewayCall(dto);
                // Only persist if gateway call was "successful" (returned intent)
                if (result.success || result.status === 'PENDING') {
                    this.logStep(3, dto);
                    await this.persist(dto, result);
                    this.logStep(4, dto);
                    await this.preExecute(dto);
                } else {
                    throw new AppError(result.message || "Provider failed to initiate", { status: 400 });
                }
            }

            // 6. Post-Gateway Logic (Commit, Updates)
            this.logStep(5, dto);
            await this.postExecute(result);

            this.logStep(6, dto);
            return this.formatResponse(result);

        } catch (error: any) {
            this.logFailureSteps(error, dto);
            await this.handleFailure(error);
            throw error;
        }
    }

    /**
     * Define the order of operations. 
     * Default is DB-First (safer for payouts).
     */
    protected shouldPersistBeforeGateway(): boolean {
        return true;
    }

    protected abstract getWorkflowName(): string;

    /**
     * Prepare context, check duplicates
     */
    protected abstract prepare(dto: T_DTO): Promise<void>;

    /**
     * Business rules, limits, route selection
     */
    protected abstract validate(dto: T_DTO): Promise<void>;

    /**
     * Save the transaction to DB. 
     * In Provider-First mode, the provider result is passed.
     */
    protected abstract persist(
        dto: T_DTO,
        gatewayResult?: T_GATEWAY
    ): Promise<void>;

    /**
     * Hook for pre-gateway financial steps (e.g. Ledger Holds)
     */
    protected async preExecute(dto: T_DTO): Promise<void> {
        // Optional hook
    }

    /**
     * Perform the actual provider API call
     */
    protected abstract gatewayCall(dto: T_DTO): Promise<T_GATEWAY>;

    /**
     * Hook for post-gateway logic
     */
    protected async postExecute(_result: T_GATEWAY): Promise<void> {
        // Optional hook
    }

    /**
     * Format the final response for the controller
     */
    protected abstract formatResponse(result: T_GATEWAY): T_RES;

    /**
     * Global Failure Handler
     */
    protected async handleFailure(error: any): Promise<void> {
        const ctx: Record<string, any> = {
            workflow: this.getWorkflowName(),
        };
        if (this.transaction) {
            ctx.transactionId = this.transaction.id;
            ctx.orderId = this.transaction.orderId;
        }

        const errorMeta = {
            errorType: error?.name,
            errorMessage: error?.message,
            errorCode: error?.code,
            retryable: error?.retryable,
        };

        logger.error(
            {
                event: "payment.workflow.failed",
                component: "payment",
                ...ctx,
                ...errorMeta,
            },
            `[Workflow] Failed: ${error.message}`
        );

        if (this.transaction) {
            const previousStatus = this.transaction.status;
            this.transaction.status = TransactionStatus.FAILED;
            this.transaction.error = error.message;
            this.transaction.events.push({
                type: "WORKFLOW_FAILED",
                timestamp: getISTDate(),
                payload: { error: error.message }
            });
            await this.transaction.save();
            if (previousStatus !== TransactionStatus.FAILED) {
                MerchantCallbackService.notify(this.transaction, { source: "WORKFLOW_FAILED" });
            }
        }

        if (!(error instanceof AppError)) {
            // Log as unexpected if not an AppError
            // console.error(error);
        }
    }

    // Helper: Round to 2 decimal places
    protected round(val: number): number {
        return Math.round((val + Number.EPSILON) * 100) / 100;
    }

    private buildStepList(): string[] {
        if (this.shouldPersistBeforeGateway()) {
            return [
                "prepare",
                "validate",
                "persist",
                "preExecute",
                "gatewayCall",
                "postExecute",
                "formatResponse",
            ];
        }
        return [
            "prepare",
            "validate",
            "gatewayCall",
            "persist",
            "preExecute",
            "postExecute",
            "formatResponse",
        ];
    }

    private logStep(stepIndex: number, dto: T_DTO): void {
        this.currentStepIndex = stepIndex;
        const stepName = this.currentSteps[stepIndex] || `step_${stepIndex + 1}`;
        const ctx: Record<string, any> = {
            workflow: this.getWorkflowName(),
            step: stepName,
            stepNumber: stepIndex + 1,
            totalSteps: this.currentSteps.length,
        };
        const orderId = (dto as any)?.orderId;
        if (orderId) ctx.orderId = orderId;
        if (this.transaction?.id) ctx.transactionId = this.transaction.id;
        logger.info(
            {
                event: "payment.workflow.step",
                component: "payment",
                ...ctx,
            },
            "[Workflow] Step"
        );
    }

    private logFailureSteps(error: any, dto: T_DTO): void {
        const stepName = this.currentSteps[this.currentStepIndex] || "unknown";
        const pendingSteps =
            this.currentStepIndex >= 0
                ? this.currentSteps.slice(this.currentStepIndex + 1)
                : this.currentSteps;
        const ctx: Record<string, any> = {
            workflow: this.getWorkflowName(),
            currentStep: stepName,
            currentStepNumber: this.currentStepIndex + 1,
            pendingSteps,
            error: error?.message,
            errorCode: error?.code,
            errorType: error?.name,
        };
        const orderId = (dto as any)?.orderId;
        if (orderId) ctx.orderId = orderId;
        if (this.transaction?.id) ctx.transactionId = this.transaction.id;
        logger.error(
            {
                event: "payment.workflow.failure_steps",
                component: "payment",
                ...ctx,
            },
            "[Workflow] Failure with pending steps"
        );
    }
}
