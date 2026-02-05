import { TransactionModel, TransactionDocument, TransactionStatus } from "@/models/transaction.model";
import { logger } from "@/infra/logger-instance";
import { getISTDate } from "@/utils/date.util";
import { AppError } from "@/utils/error";

export abstract class BasePaymentWorkflow<T_DTO> {
    protected merchant: any;
    protected requestIp: string;
    protected transaction!: TransactionDocument;

    constructor(merchant: any, requestIp: string) {
        this.merchant = merchant;
        this.requestIp = requestIp;
    }

    /**
     * Main Execution Template
     */
    async execute(dto: T_DTO): Promise<any> {
        try {
            logger.info(`[Workflow] Starting ${this.getWorkflowName()} for merchant ${this.merchant.id}`);

            // 1. Initial Checks & Context
            await this.prepare(dto);

            // 2. Business Validations (Limits, Routing, Fees)
            await this.validate(dto);

            let result: any;

            if (this.shouldPersistBeforeGateway()) {
                // DB-First (Payout)
                await this.persist(dto);
                await this.preExecute(dto);
                result = await this.gatewayCall(dto);
            } else {
                // Provider-First (Payin)
                result = await this.gatewayCall(dto);
                // Only persist if gateway call was "successful" (returned intent)
                if (result.success || result.status === 'PENDING') {
                    await this.persist(dto, result);
                    await this.preExecute(dto);
                } else {
                    throw new AppError(result.message || "Provider failed to initiate", { status: 400 });
                }
            }

            // 6. Post-Gateway Logic (Commit, Updates)
            await this.postExecute(result);

            return this.formatResponse(result);

        } catch (error: any) {
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
    protected abstract persist(dto: T_DTO, gatewayResult?: any): Promise<void>;

    /**
     * Hook for pre-gateway financial steps (e.g. Ledger Holds)
     */
    protected async preExecute(dto: T_DTO): Promise<void> {
        // Optional hook
    }

    /**
     * Perform the actual provider API call
     */
    protected abstract gatewayCall(dto: T_DTO): Promise<any>;

    /**
     * Hook for post-gateway logic
     */
    protected async postExecute(result: any): Promise<void> {
        // Optional hook
    }

    /**
     * Format the final response for the controller
     */
    protected abstract formatResponse(result: any): any;

    /**
     * Global Failure Handler
     */
    protected async handleFailure(error: any): Promise<void> {
        logger.error(`[Workflow: ${this.getWorkflowName()}] Failed: ${error.message}`);

        if (this.transaction) {
            this.transaction.status = TransactionStatus.FAILED;
            this.transaction.error = error.message;
            this.transaction.events.push({
                type: "WORKFLOW_FAILED",
                timestamp: getISTDate(),
                payload: { error: error.message }
            });
            await this.transaction.save();
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
}
