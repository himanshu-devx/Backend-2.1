import { TransactionModel, TransactionDocument, TransactionStatus } from "@/models/transaction.model";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { AppError } from "@/utils/error";
import { CacheService } from "@/services/common/cache.service";
import { Metrics } from "@/infra/metrics";
import { sampleFromId, shouldSample } from "@/infra/log-sampling";
import { TransactionOutboxService } from "@/services/payment/transaction-outbox.service";

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
    private workflowStartMs: number = 0;
    private workflowSampled: boolean = true;

    constructor(merchant: any, requestIp: string) {
        this.merchant = merchant;
        this.requestIp = requestIp;
    }

    /**
     * Main Execution Template
     */
    async execute(dto: T_DTO): Promise<T_RES> {
        this.currentSteps = this.buildStepList();
        this.workflowStartMs = Date.now();
        const orderId = (dto as any)?.orderId;
        this.workflowSampled = sampleFromId(orderId) || shouldSample();
        Metrics.paymentRequest(this.getWorkflowName());
        try {
            logger.info(`[Workflow] Starting ${this.getWorkflowName()} for merchant ${this.merchant.id}`);

            // 1. Initial Checks & Context
            this.logStep(0, dto);
            const prepareStart = Date.now();
            await this.prepare(dto);
            this.logStepDuration(0, prepareStart);

            // 2. Business Validations (Limits, Routing, Fees)
            this.logStep(1, dto);
            const validateStart = Date.now();
            await this.validate(dto);
            this.logStepDuration(1, validateStart);

            let result: any;

            if (this.shouldPersistBeforeGateway()) {
                // DB-First (Payout)
                this.logStep(2, dto);
                const persistStart = Date.now();
                await this.persist(dto);
                this.logStepDuration(2, persistStart);
                this.logStep(3, dto);
                const preExecuteStart = Date.now();
                await this.preExecute(dto);
                this.logStepDuration(3, preExecuteStart);
                this.logStep(4, dto);
                const gatewayStart = Date.now();
                result = await this.gatewayCall(dto);
                this.logStepDuration(4, gatewayStart);
            } else {
                // Provider-First (Payin)
                this.logStep(2, dto);
                const gatewayStart = Date.now();
                result = await this.gatewayCall(dto);
                this.logStepDuration(2, gatewayStart);
                // Only persist if gateway call was "successful" (returned intent)
                if (result.success || result.status === 'PENDING') {
                    this.logStep(3, dto);
                    const persistStart = Date.now();
                    await this.persist(dto, result);
                    this.logStepDuration(3, persistStart);
                    this.logStep(4, dto);
                    const preExecuteStart = Date.now();
                    await this.preExecute(dto);
                    this.logStepDuration(4, preExecuteStart);
                } else {
                    throw new AppError(result.message || "Provider failed to initiate", { status: 400 });
                }
            }

            // 6. Post-Gateway Logic (Commit, Updates)
            this.logStep(5, dto);
            const postExecuteStart = Date.now();
            await this.postExecute(result);
            this.logStepDuration(5, postExecuteStart);

            this.logStep(6, dto);
            const totalMs = Date.now() - this.workflowStartMs;
            Metrics.paymentOutcome(this.getWorkflowName(), "success");
            Metrics.paymentLatency(this.getWorkflowName(), "success", totalMs);
            logger.info(
                {
                    workflow: this.getWorkflowName(),
                    durationMs: totalMs
                },
                "[Workflow] Completed"
            );
            return this.formatResponse(result);

        } catch (error: any) {
            const totalMs = Date.now() - this.workflowStartMs;
            Metrics.paymentOutcome(this.getWorkflowName(), "failed");
            Metrics.paymentLatency(this.getWorkflowName(), "failed", totalMs);
            logger.error(
                {
                    workflow: this.getWorkflowName(),
                    durationMs: totalMs,
                    error: error?.message
                },
                "[Workflow] Failed"
            );
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

        logger.error(ctx, `[Workflow] Failed: ${error.message}`);

        if (this.transaction) {
            this.transaction.status = TransactionStatus.FAILED;
            this.transaction.error = error.message;
            this.transaction.events.push({
                type: "WORKFLOW_FAILED",
                timestamp: getISTDate(),
                payload: { error: error.message }
            });
            await this.transaction.save();
            await CacheService.setTransactionCache(this.transaction);
            await TransactionOutboxService.enqueueMerchantCallback(this.transaction);
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
        if (!this.workflowSampled) return;
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
        logger.info(ctx, "[Workflow] Step");
    }

    private logStepDuration(stepIndex: number, startedAtMs: number): void {
        if (!this.workflowSampled) return;
        const stepName = this.currentSteps[stepIndex] || `step_${stepIndex + 1}`;
        const durationMs = Date.now() - startedAtMs;
        Metrics.paymentStepLatency(this.getWorkflowName(), stepName, durationMs);
        logger.info(
            {
                workflow: this.getWorkflowName(),
                step: stepName,
                durationMs
            },
            "[Workflow] Step completed"
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
        };
        const orderId = (dto as any)?.orderId;
        if (orderId) ctx.orderId = orderId;
        if (this.transaction?.id) ctx.transactionId = this.transaction.id;
        logger.error(ctx, "[Workflow] Failure with pending steps");
    }
}
