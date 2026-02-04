import { ACCOUNT_TYPE, AccountTypeKey } from "./tigerbeetle.constant";

/**
 * Transfer operation type codes for TigerBeetle transfers
 * These codes are stored in the 'code' field of each transfer
 */
export const TRANSFER_OPERATION_CODES = {
    // Standard transaction types
    PAYIN: 1,
    PAYOUT: 2,
    INTERNAL_TRANSFER: 3,

    // Merchant operations
    MERCHANT_SETTLEMENT: 10,
    MERCHANT_PAYOUT_FUND: 11,
    MERCHANT_DEDUCT: 12,
    MERCHANT_FEES: 13,
    MERCHANT_REFUND: 14,
    MERCHANT_HOLD: 15,
    MERCHANT_RELEASE: 16,

    // Provider operations
    PROVIDER_SETTLEMENT: 20,
    PROVIDER_TOPUP: 21,
    PROVIDER_FEES: 22,
    PROVIDER_FEES_SETTLE: 23,

    INCOME_SETTLE: 30,
} as const;

export type TransferOperationCode = typeof TRANSFER_OPERATION_CODES[keyof typeof TRANSFER_OPERATION_CODES];

export interface TransferOperationField {
    key: string;
    label: string;
    type?: "text" | "number" | "date";
    required?: boolean;
    description?: string;
}

export interface TransferOperationDef {
    label: string;
    group: "MERCHANT" | "PROVIDER" | "LEGAL_ENTITY" | "SUPER_ADMIN";
    entityType: "MERCHANT" | "PROVIDER_LEGAL_ENTITY" | "LEGAL_ENTITY" | "SUPER_ADMIN";
    sources: string[]; // Array of possible source slugs
    destinations: string[]; // Array of possible dest slugs
    description: string;
    recommendedFields?: TransferOperationField[];
}


export const TRANSFER_OPERATIONS: Record<string, TransferOperationDef> = {
    // =============================
    // MERCHANT OPERATIONS
    // =============================
    MERCHANT_SETTLEMENT: {
        label: "Merchant Settlement (Payin -> Payout)",
        group: "MERCHANT",
        entityType: "MERCHANT",
        sources: [ACCOUNT_TYPE.MERCHANT_PAYIN.slug],
        destinations: [ACCOUNT_TYPE.MERCHANT_PAYOUT.slug],
        description: "Move confirmed Payin funds to Payout balance for withdrawal."
    },
    MERCHANT_PAYOUT_FUND: {
        label: "Merchant Deposit (Top-up Payout)",
        group: "MERCHANT",
        entityType: "MERCHANT",
        sources: ["WORLD"],
        destinations: [ACCOUNT_TYPE.MERCHANT_PAYOUT.slug],
        description: "Add external funds to Merchant Payout balance.",
        recommendedFields: [
            { key: "utr", label: "UTR / Transaction Ref", required: true },
            { key: "fromAccount", label: "Sender Account Details" },
            { key: "bankName", label: "Bank Name" }
        ]
    },
    MERCHANT_DEDUCT: {
        label: "Merchant Deduction (Penalty/Correction)",
        group: "MERCHANT",
        entityType: "MERCHANT",
        sources: [ACCOUNT_TYPE.MERCHANT_PAYIN.slug, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug],
        destinations: ["WORLD"],
        description: "Deduct funds from Merchant Payin or Payout balance.",
        recommendedFields: [
            { key: "ticketId", label: "Support Ticket ID" },
            { key: "reason", label: "Reason for Deduction", required: true },
            { key: "beneficiaryAccount", label: "Beneficiary/Destination Account" }
        ]
    },
    MERCHANT_FEES: {
        label: "Merchant Fee Collection",
        group: "MERCHANT",
        entityType: "MERCHANT",
        sources: [ACCOUNT_TYPE.MERCHANT_PAYOUT.slug, ACCOUNT_TYPE.MERCHANT_PAYIN.slug],
        destinations: [ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug],
        description: "Manually collect fees from Merchant to System Income."
    },
    MERCHANT_REFUND: {
        label: "Merchant Refund (Payin/Payout Reversal)",
        group: "MERCHANT",
        entityType: "MERCHANT",
        destinations: [ACCOUNT_TYPE.MERCHANT_PAYIN.slug, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug],
        sources: ["WORLD"],
        description: "Refund funds back to World/User.",
        recommendedFields: [
            { key: "originalTxnId", label: "Original Transaction ID" },
            { key: "reason", label: "Reason" }
        ]
    },
    MERCHANT_HOLD: {
        label: "Merchant Hold (Freeze Funds)",
        group: "MERCHANT",
        entityType: "MERCHANT",
        sources: [ACCOUNT_TYPE.MERCHANT_PAYIN.slug, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug],
        destinations: [ACCOUNT_TYPE.MERCHANT_HOLD.slug],
        description: "Move funds to Hold account.",
        recommendedFields: [
            { key: "reason", label: "Hold Reason", required: true },
            { key: "expiryDate", label: "Hold Expiry (Optional)", type: "date" }
        ]
    },
    MERCHANT_RELEASE: {
        label: "Merchant Release (Unfreeze Funds)",
        group: "MERCHANT",
        entityType: "MERCHANT",
        sources: [ACCOUNT_TYPE.MERCHANT_HOLD.slug],
        destinations: [ACCOUNT_TYPE.MERCHANT_PAYIN.slug, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug],
        description: "Release funds from Hold account.",
        recommendedFields: [
            { key: "reason", label: "Release Reason" }
        ]
    },

    // =============================
    // PROVIDER LE OPERATIONS
    // =============================
    PROVIDER_SETTLEMENT: {
        label: "Provider Settlement (Withdraw Payin)",
        group: "PROVIDER",
        entityType: "PROVIDER_LEGAL_ENTITY",
        sources: [ACCOUNT_TYPE.PROVIDER_PAYIN.slug],
        destinations: [ACCOUNT_TYPE.LEGAL_ENTITY_MAIN.slug],
        description: "Withdraw collected funds from Provider Channel to Legal Entity Main."
    },
    PROVIDER_TOPUP: {
        label: "Provider Top-up (Fund Payouts)",
        group: "PROVIDER",
        entityType: "PROVIDER_LEGAL_ENTITY",
        sources: [ACCOUNT_TYPE.LEGAL_ENTITY_MAIN.slug],
        destinations: [ACCOUNT_TYPE.PROVIDER_PAYOUT.slug],
        description: "Fund Provider Channel Payout balance from Legal Entity Main."
    },
    PROVIDER_FEES: {
        label: "Provider Expense/Fee",
        group: "PROVIDER",
        entityType: "PROVIDER_LEGAL_ENTITY",
        sources: [ACCOUNT_TYPE.PROVIDER_PAYIN.slug, ACCOUNT_TYPE.PROVIDER_PAYOUT.slug],
        destinations: [ACCOUNT_TYPE.PROVIDER_EXPENSE.slug],
        description: "Record provider expenses from Payin or Payout."
    },
    PROVIDER_FEES_SETTLE: {
        label: "Settle Provider Expense (Expense -> Income)",
        group: "PROVIDER",
        entityType: "PROVIDER_LEGAL_ENTITY",
        sources: [ACCOUNT_TYPE.PROVIDER_EXPENSE.slug],
        destinations: [ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug],
        description: "Settle accumulated Provider Expense to System Income."
    },

    // =============================
    // INCOME OPERATIONS
    // =============================
    INCOME_SETTLE: {
        label: "Income Payout (Income -> Merchant)",
        group: "LEGAL_ENTITY",
        entityType: "MERCHANT", // Changed to MERCHANT to select target
        sources: [ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug],
        destinations: [ACCOUNT_TYPE.MERCHANT_PAYOUT.slug],
        description: "Transfer accumulated income to a specific Merchant Payout account."
    }
};
