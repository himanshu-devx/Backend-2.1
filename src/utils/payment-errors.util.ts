/**
 * Payment Error Codes
 * Standardized error handling for payment operations
 */

export enum PaymentErrorCode {
    // Validation Errors (1000-1099)
    INVALID_AMOUNT = "PAY_1001",
    INVALID_CUSTOMER_INFO = "PAY_1002",
    INVALID_PAYMENT_MODE = "PAY_1003",
    INVALID_BENEFICIARY_INFO = "PAY_1004",
    DUPLICATE_ORDER_ID = "PAY_1005",
    INVALID_ORDER_ID = "PAY_1006",

    // Configuration Errors (1100-1199)
    SERVICE_DISABLED = "PAY_1101",
    ROUTING_NOT_CONFIGURED = "PAY_1102",
    CHANNEL_NOT_FOUND = "PAY_1103",
    CHANNEL_INACTIVE = "PAY_1104",
    FEE_CONFIG_MISSING = "PAY_1105",
    PROVIDER_CONFIG_MISSING = "PAY_1106",

    // Limit & Balance Errors (1200-1299)
    AMOUNT_BELOW_MINIMUM = "PAY_1201",
    AMOUNT_ABOVE_MAXIMUM = "PAY_1202",
    DAILY_LIMIT_EXCEEDED = "PAY_1203",
    MONTHLY_LIMIT_EXCEEDED = "PAY_1204",
    INSUFFICIENT_BALANCE = "PAY_1205",

    // Provider Errors (1300-1399)
    PROVIDER_UNAVAILABLE = "PAY_1301",
    PROVIDER_TIMEOUT = "PAY_1302",
    PROVIDER_REJECTED = "PAY_1303",
    PROVIDER_INVALID_RESPONSE = "PAY_1304",
    PROVIDER_MAINTENANCE = "PAY_1305",

    // Ledger Errors (1400-1499)
    LEDGER_HOLD_FAILED = "PAY_1401",
    LEDGER_COMMIT_FAILED = "PAY_1402",
    LEDGER_ROLLBACK_FAILED = "PAY_1403",
    LEDGER_UNAVAILABLE = "PAY_1404",

    // Database Errors (1500-1599)
    DB_WRITE_FAILED = "PAY_1501",
    DB_READ_FAILED = "PAY_1502",
    DB_DUPLICATE_KEY = "PAY_1503",
    DB_CONNECTION_FAILED = "PAY_1504",

    // Workflow Errors (1600-1699)
    WORKFLOW_VALIDATION_FAILED = "PAY_1601",
    WORKFLOW_EXECUTION_FAILED = "PAY_1602",
    WORKFLOW_STATE_INVALID = "PAY_1603",

    // Generic Errors (1900-1999)
    INTERNAL_ERROR = "PAY_1901",
    UNKNOWN_ERROR = "PAY_1999",
}

export interface PaymentErrorDetail {
    code: PaymentErrorCode;
    message: string;
    description: string;
    httpStatus: number;
    retryable: boolean;
}

export const PAYMENT_ERROR_CATALOG: Record<PaymentErrorCode, PaymentErrorDetail> = {
    // Validation Errors
    [PaymentErrorCode.INVALID_AMOUNT]: {
        code: PaymentErrorCode.INVALID_AMOUNT,
        message: "Invalid transaction amount",
        description: "The transaction amount must be a positive number greater than zero",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.INVALID_CUSTOMER_INFO]: {
        code: PaymentErrorCode.INVALID_CUSTOMER_INFO,
        message: "Invalid customer information",
        description: "Customer name, email, or phone number is missing or invalid",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.INVALID_PAYMENT_MODE]: {
        code: PaymentErrorCode.INVALID_PAYMENT_MODE,
        message: "Invalid payment mode",
        description: "The specified payment mode is not supported",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.INVALID_BENEFICIARY_INFO]: {
        code: PaymentErrorCode.INVALID_BENEFICIARY_INFO,
        message: "Invalid beneficiary information",
        description: "Beneficiary account number, IFSC, or name is missing or invalid",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.DUPLICATE_ORDER_ID]: {
        code: PaymentErrorCode.DUPLICATE_ORDER_ID,
        message: "Duplicate order ID",
        description: "A transaction with this order ID already exists",
        httpStatus: 409,
        retryable: false
    },
    [PaymentErrorCode.INVALID_ORDER_ID]: {
        code: PaymentErrorCode.INVALID_ORDER_ID,
        message: "Invalid order ID format",
        description: "The order ID format is invalid or contains special characters",
        httpStatus: 400,
        retryable: false
    },

    // Configuration Errors
    [PaymentErrorCode.SERVICE_DISABLED]: {
        code: PaymentErrorCode.SERVICE_DISABLED,
        message: "Payment service is disabled",
        description: "The payment service is currently disabled for this merchant",
        httpStatus: 403,
        retryable: false
    },
    [PaymentErrorCode.ROUTING_NOT_CONFIGURED]: {
        code: PaymentErrorCode.ROUTING_NOT_CONFIGURED,
        message: "Payment routing not configured",
        description: "No payment provider routing is configured for this merchant",
        httpStatus: 500,
        retryable: false
    },
    [PaymentErrorCode.CHANNEL_NOT_FOUND]: {
        code: PaymentErrorCode.CHANNEL_NOT_FOUND,
        message: "Payment channel not found",
        description: "The configured payment channel could not be found",
        httpStatus: 500,
        retryable: false
    },
    [PaymentErrorCode.CHANNEL_INACTIVE]: {
        code: PaymentErrorCode.CHANNEL_INACTIVE,
        message: "Payment channel is inactive",
        description: "The payment channel is currently inactive or under maintenance",
        httpStatus: 503,
        retryable: true
    },
    [PaymentErrorCode.FEE_CONFIG_MISSING]: {
        code: PaymentErrorCode.FEE_CONFIG_MISSING,
        message: "Fee configuration missing",
        description: "Fee configuration is not set up for this payment channel",
        httpStatus: 500,
        retryable: false
    },
    [PaymentErrorCode.PROVIDER_CONFIG_MISSING]: {
        code: PaymentErrorCode.PROVIDER_CONFIG_MISSING,
        message: "Provider configuration missing",
        description: "Payment provider credentials or configuration is missing",
        httpStatus: 500,
        retryable: false
    },

    // Limit & Balance Errors
    [PaymentErrorCode.AMOUNT_BELOW_MINIMUM]: {
        code: PaymentErrorCode.AMOUNT_BELOW_MINIMUM,
        message: "Amount below minimum limit",
        description: "The transaction amount is below the minimum allowed limit",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.AMOUNT_ABOVE_MAXIMUM]: {
        code: PaymentErrorCode.AMOUNT_ABOVE_MAXIMUM,
        message: "Amount exceeds maximum limit",
        description: "The transaction amount exceeds the maximum allowed limit",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.DAILY_LIMIT_EXCEEDED]: {
        code: PaymentErrorCode.DAILY_LIMIT_EXCEEDED,
        message: "Daily transaction limit exceeded",
        description: "The daily transaction limit has been reached",
        httpStatus: 429,
        retryable: false
    },
    [PaymentErrorCode.MONTHLY_LIMIT_EXCEEDED]: {
        code: PaymentErrorCode.MONTHLY_LIMIT_EXCEEDED,
        message: "Monthly transaction limit exceeded",
        description: "The monthly transaction limit has been reached",
        httpStatus: 429,
        retryable: false
    },
    [PaymentErrorCode.INSUFFICIENT_BALANCE]: {
        code: PaymentErrorCode.INSUFFICIENT_BALANCE,
        message: "Insufficient balance",
        description: "Insufficient balance to process this payout transaction",
        httpStatus: 402,
        retryable: false
    },

    // Provider Errors
    [PaymentErrorCode.PROVIDER_UNAVAILABLE]: {
        code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
        message: "Payment provider unavailable",
        description: "The payment provider is currently unavailable",
        httpStatus: 503,
        retryable: true
    },
    [PaymentErrorCode.PROVIDER_TIMEOUT]: {
        code: PaymentErrorCode.PROVIDER_TIMEOUT,
        message: "Payment provider timeout",
        description: "The payment provider did not respond within the expected time",
        httpStatus: 504,
        retryable: true
    },
    [PaymentErrorCode.PROVIDER_REJECTED]: {
        code: PaymentErrorCode.PROVIDER_REJECTED,
        message: "Transaction rejected by provider",
        description: "The payment provider rejected this transaction",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.PROVIDER_INVALID_RESPONSE]: {
        code: PaymentErrorCode.PROVIDER_INVALID_RESPONSE,
        message: "Invalid provider response",
        description: "The payment provider returned an invalid or unexpected response",
        httpStatus: 502,
        retryable: true
    },
    [PaymentErrorCode.PROVIDER_MAINTENANCE]: {
        code: PaymentErrorCode.PROVIDER_MAINTENANCE,
        message: "Provider under maintenance",
        description: "The payment provider is currently under maintenance",
        httpStatus: 503,
        retryable: true
    },

    // Ledger Errors
    [PaymentErrorCode.LEDGER_HOLD_FAILED]: {
        code: PaymentErrorCode.LEDGER_HOLD_FAILED,
        message: "Unable to reserve funds",
        description: "Unable to reserve funds for this payout transaction",
        httpStatus: 500,
        retryable: false
    },
    [PaymentErrorCode.LEDGER_COMMIT_FAILED]: {
        code: PaymentErrorCode.LEDGER_COMMIT_FAILED,
        message: "Failed to commit transaction",
        description: "Unable to commit the transaction in the ledger",
        httpStatus: 500,
        retryable: true
    },
    [PaymentErrorCode.LEDGER_ROLLBACK_FAILED]: {
        code: PaymentErrorCode.LEDGER_ROLLBACK_FAILED,
        message: "Failed to rollback transaction",
        description: "Unable to rollback the transaction in the ledger",
        httpStatus: 500,
        retryable: false
    },
    [PaymentErrorCode.LEDGER_UNAVAILABLE]: {
        code: PaymentErrorCode.LEDGER_UNAVAILABLE,
        message: "Ledger service unavailable",
        description: "The ledger service is currently unavailable",
        httpStatus: 503,
        retryable: true
    },

    // Database Errors
    [PaymentErrorCode.DB_WRITE_FAILED]: {
        code: PaymentErrorCode.DB_WRITE_FAILED,
        message: "Database write failed",
        description: "Failed to write transaction data to the database",
        httpStatus: 500,
        retryable: true
    },
    [PaymentErrorCode.DB_READ_FAILED]: {
        code: PaymentErrorCode.DB_READ_FAILED,
        message: "Database read failed",
        description: "Failed to read data from the database",
        httpStatus: 500,
        retryable: true
    },
    [PaymentErrorCode.DB_DUPLICATE_KEY]: {
        code: PaymentErrorCode.DB_DUPLICATE_KEY,
        message: "Duplicate transaction detected",
        description: "A transaction with the same unique identifier already exists",
        httpStatus: 409,
        retryable: false
    },
    [PaymentErrorCode.DB_CONNECTION_FAILED]: {
        code: PaymentErrorCode.DB_CONNECTION_FAILED,
        message: "Database connection failed",
        description: "Unable to establish connection to the database",
        httpStatus: 503,
        retryable: true
    },

    // Workflow Errors
    [PaymentErrorCode.WORKFLOW_VALIDATION_FAILED]: {
        code: PaymentErrorCode.WORKFLOW_VALIDATION_FAILED,
        message: "Workflow validation failed",
        description: "The payment workflow validation checks failed",
        httpStatus: 400,
        retryable: false
    },
    [PaymentErrorCode.WORKFLOW_EXECUTION_FAILED]: {
        code: PaymentErrorCode.WORKFLOW_EXECUTION_FAILED,
        message: "Workflow execution failed",
        description: "An error occurred during workflow execution",
        httpStatus: 500,
        retryable: true
    },
    [PaymentErrorCode.WORKFLOW_STATE_INVALID]: {
        code: PaymentErrorCode.WORKFLOW_STATE_INVALID,
        message: "Invalid workflow state",
        description: "The workflow is in an invalid state for this operation",
        httpStatus: 409,
        retryable: false
    },

    // Generic Errors
    [PaymentErrorCode.INTERNAL_ERROR]: {
        code: PaymentErrorCode.INTERNAL_ERROR,
        message: "Internal server error",
        description: "An unexpected internal error occurred while processing the payment",
        httpStatus: 500,
        retryable: true
    },
    [PaymentErrorCode.UNKNOWN_ERROR]: {
        code: PaymentErrorCode.UNKNOWN_ERROR,
        message: "Unknown error",
        description: "An unknown error occurred",
        httpStatus: 500,
        retryable: false
    },
};

/**
 * Payment Error Class
 */
export class PaymentError extends Error {
    public readonly code: PaymentErrorCode;
    public readonly httpStatus: number;
    public readonly retryable: boolean;
    public readonly description: string;
    public readonly details?: any;
    public readonly isMerchantFacing: boolean;

    constructor(code: PaymentErrorCode, details?: any) {
        const errorDetail = PAYMENT_ERROR_CATALOG[code];
        super(errorDetail.message);

        this.name = "PaymentError";
        this.code = code;
        this.httpStatus = errorDetail.httpStatus;
        this.retryable = errorDetail.retryable;
        this.description = errorDetail.description;
        this.details = details;

        // Determine if this error should be shown to merchants
        this.isMerchantFacing = this.isErrorMerchantFacing(code);

        // Maintains proper stack trace
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * Determine if error code should be exposed to merchants
     * Internal system errors are masked
     */
    private isErrorMerchantFacing(code: PaymentErrorCode): boolean {
        const internalErrorCodes = [
            // Configuration errors that expose system internals
            PaymentErrorCode.ROUTING_NOT_CONFIGURED,
            PaymentErrorCode.CHANNEL_NOT_FOUND,
            PaymentErrorCode.FEE_CONFIG_MISSING,
            PaymentErrorCode.PROVIDER_CONFIG_MISSING,

            // All ledger errors
            PaymentErrorCode.LEDGER_HOLD_FAILED,
            PaymentErrorCode.LEDGER_COMMIT_FAILED,
            PaymentErrorCode.LEDGER_ROLLBACK_FAILED,
            PaymentErrorCode.LEDGER_UNAVAILABLE,

            // All database errors except duplicate
            PaymentErrorCode.DB_WRITE_FAILED,
            PaymentErrorCode.DB_READ_FAILED,
            PaymentErrorCode.DB_CONNECTION_FAILED,

            // All workflow errors
            PaymentErrorCode.WORKFLOW_VALIDATION_FAILED,
            PaymentErrorCode.WORKFLOW_EXECUTION_FAILED,
            PaymentErrorCode.WORKFLOW_STATE_INVALID,

            // Provider internal errors
            PaymentErrorCode.PROVIDER_INVALID_RESPONSE,
        ];

        return !internalErrorCodes.includes(code);
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                description: this.description,
                retryable: this.retryable,
                details: this.details
            }
        };
    }

    /**
     * Merchant-facing error response (masks internal system errors)
     */
    toMerchantJSON() {
        if (this.isMerchantFacing) {
            let message = this.message;
            if (this.code === PaymentErrorCode.PROVIDER_REJECTED) {
                const providerId = String(this.details?.providerId || "").toLowerCase();
                const providerMessage =
                    this.details?.providerMessage ||
                    this.details?.providerResponse?.providerMsg ||
                    this.details?.providerResponse?.message;
                if (providerId === "atis" && typeof providerMessage === "string" && providerMessage.trim()) {
                    message = providerMessage.trim();
                }
            }
            return {
                error: {
                    code: this.code,
                    message,
                    description: this.description,
                    retryable: this.retryable
                }
            };
        }

        // Mask internal errors with generic message
        return {
            error: {
                code: PaymentErrorCode.INTERNAL_ERROR,
                message: "Unable to process payment",
                description: "An error occurred while processing your payment. Please try again or contact support.",
                retryable: this.retryable
            }
        };
    }
}

/**
 * Helper function to map common errors to Payment Errors
 */
export function mapToPaymentError(error: any): PaymentError {
    // MongoDB duplicate key error
    if (error.code === 11000 || error.message?.includes('E11000')) {
        return new PaymentError(PaymentErrorCode.DB_DUPLICATE_KEY, {
            originalError: error.message
        });
    }

    // Mongoose validation errors
    if (error.name === 'ValidationError') {
        return new PaymentError(PaymentErrorCode.WORKFLOW_VALIDATION_FAILED, {
            validationErrors: error.errors
        });
    }

    // Timeout errors
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return new PaymentError(PaymentErrorCode.PROVIDER_TIMEOUT, {
            originalError: error.message
        });
    }

    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return new PaymentError(PaymentErrorCode.PROVIDER_UNAVAILABLE, {
            originalError: error.message
        });
    }

    // Provider config / routing errors
    if (
        error.message?.includes("No credentials for") ||
        error.message?.includes("Multiple credentials found for provider") ||
        error.message?.includes("Unsupported provider") ||
        error.message?.includes("Provider not found")
    ) {
        return new PaymentError(PaymentErrorCode.PROVIDER_CONFIG_MISSING, {
            originalError: error.message
        });
    }

    // If already a PaymentError, return as-is
    if (error instanceof PaymentError) {
        return error;
    }

    // Default to internal error
    return new PaymentError(PaymentErrorCode.INTERNAL_ERROR, {
        originalError: error.message,
        stack: error.stack
    });
}
