import { TransactionType } from "@/constants/transaction.constant";

export const LEDGER_OPERATION = {
  MERCHANT_SETTLEMENT_PAYOUT: "MERCHANT_SETTLEMENT_PAYOUT",
  MERCHANT_SETTLEMENT_BANK: "MERCHANT_SETTLEMENT_BANK",
  MERCHANT_DEPOSIT: "MERCHANT_DEPOSIT",
  MERCHANT_WITHDRAWAL: "MERCHANT_WITHDRAWAL",
  MERCHANT_DEDUCT: "MERCHANT_DEDUCT",
  MERCHANT_REFUND: "MERCHANT_REFUND",
  MERCHANT_HOLD: "MERCHANT_HOLD",
  MERCHANT_RELEASE: "MERCHANT_RELEASE",
  MERCHANT_FEES: "MERCHANT_FEES",
  INCOME_SETTLEMENT_TO_MERCHANT: "INCOME_SETTLEMENT_TO_MERCHANT",

  LEGAL_ENTITY_SETTLEMENT: "LEGAL_ENTITY_SETTLEMENT",
  LEGAL_ENTITY_DEPOSIT: "LEGAL_ENTITY_DEPOSIT",
  LEGAL_ENTITY_DEDUCT: "LEGAL_ENTITY_DEDUCT",

  PLE_SETTLEMENT: "PLE_SETTLEMENT",
  PLE_DEPOSIT: "PLE_DEPOSIT",
  PLE_EXPENSE_SETTLEMENT: "PLE_EXPENSE_SETTLEMENT",
  PLE_EXPENSE_CHARGE: "PLE_EXPENSE_CHARGE",
} as const;

export type LedgerOperationType =
  (typeof LEDGER_OPERATION)[keyof typeof LEDGER_OPERATION];

export const LEDGER_OPERATION_META: Record<
  LedgerOperationType,
  {
    description: string;
    required: Array<
      "merchantId" | "providerId" | "legalEntityId" | "providerLegalEntityId"
    >;
    optional: string[];
  }
> = {
  MERCHANT_SETTLEMENT_PAYOUT: {
    description: "Merchant PAYIN -> Merchant PAYOUT (internal settlement)",
    required: ["merchantId"],
    optional: ["valueDate", "accountType", "metadata", "utr", "remarks"],
  },
  MERCHANT_SETTLEMENT_BANK: {
    description: "Merchant PAYIN -> WORLD (bank settlement)",
    required: ["merchantId"],
    optional: ["bankAccountId", "valueDate", "metadata", "utr", "remarks"],
  },
  MERCHANT_DEPOSIT: {
    description: "WORLD -> Merchant PAYOUT (deposit/topup)",
    required: ["merchantId"],
    optional: ["bankAccountId", "valueDate", "metadata", "utr", "remarks"],
  },
  MERCHANT_WITHDRAWAL: {
    description: "Merchant PAYIN/PAYOUT -> WORLD (withdrawal)",
    required: ["merchantId"],
    optional: ["bankAccountId", "accountType", "valueDate", "metadata", "utr"],
  },
  MERCHANT_DEDUCT: {
    description: "Merchant PAYIN/PAYOUT -> WORLD (manual deduction)",
    required: ["merchantId"],
    optional: ["accountType", "valueDate", "metadata", "utr"],
  },
  MERCHANT_REFUND: {
    description: "Merchant PAYIN/PAYOUT -> WORLD (refund outflow)",
    required: ["merchantId"],
    optional: ["accountType", "valueDate", "metadata", "utr"],
  },
  MERCHANT_HOLD: {
    description: "Merchant PAYIN/PAYOUT -> Merchant HOLD",
    required: ["merchantId"],
    optional: ["accountType", "valueDate", "metadata", "utr"],
  },
  MERCHANT_RELEASE: {
    description: "Merchant HOLD -> Merchant PAYIN/PAYOUT",
    required: ["merchantId"],
    optional: ["accountType", "valueDate", "metadata", "utr"],
  },
  MERCHANT_FEES: {
    description: "Merchant PAYIN/PAYOUT -> INCOME (manual fee charge)",
    required: ["merchantId"],
    optional: ["accountType", "valueDate", "metadata", "utr"],
  },
  INCOME_SETTLEMENT_TO_MERCHANT: {
    description: "INCOME -> Merchant PAYIN/PAYOUT",
    required: ["merchantId"],
    optional: ["targetAccountType", "valueDate", "metadata", "utr"],
  },
  LEGAL_ENTITY_SETTLEMENT: {
    description: "Provider PAYIN -> Legal Entity BANK",
    required: ["legalEntityId", "providerLegalEntityId"],
    optional: ["valueDate", "metadata", "utr"],
  },
  LEGAL_ENTITY_DEPOSIT: {
    description: "Legal Entity BANK -> Provider PAYOUT",
    required: ["legalEntityId", "providerLegalEntityId"],
    optional: ["valueDate", "metadata", "utr"],
  },
  LEGAL_ENTITY_DEDUCT: {
    description: "Legal Entity BANK -> WORLD",
    required: ["legalEntityId"],
    optional: ["valueDate", "metadata", "utr"],
  },
  PLE_SETTLEMENT: {
    description: "Provider PAYIN -> Legal Entity BANK (by PLE)",
    required: ["providerLegalEntityId"],
    optional: ["valueDate", "metadata", "utr"],
  },
  PLE_DEPOSIT: {
    description: "Legal Entity BANK -> Provider PAYOUT (by PLE)",
    required: ["providerLegalEntityId"],
    optional: ["valueDate", "metadata", "utr"],
  },
  PLE_EXPENSE_SETTLEMENT: {
    description: "Provider EXPENSE -> INCOME",
    required: ["providerLegalEntityId"],
    optional: ["valueDate", "metadata", "utr"],
  },
  PLE_EXPENSE_CHARGE: {
    description: "WORLD -> Provider EXPENSE (increase expense)",
    required: ["providerLegalEntityId"],
    optional: ["valueDate", "metadata", "utr"],
  },
};

export const LEDGER_OPERATION_DEFAULT_TXN: Record<
  LedgerOperationType,
  TransactionType
> = {
  MERCHANT_SETTLEMENT_PAYOUT: TransactionType.MERCHANT_SETTLEMENT,
  MERCHANT_SETTLEMENT_BANK: TransactionType.MERCHANT_BANK_SETTLEMENT,
  MERCHANT_DEPOSIT: TransactionType.MERCHANT_DEPOSIT,
  MERCHANT_WITHDRAWAL: TransactionType.MERCHANT_WITHDRAWAL,
  MERCHANT_DEDUCT: TransactionType.MERCHANT_DEDUCT,
  MERCHANT_REFUND: TransactionType.MERCHANT_REFUND,
  MERCHANT_HOLD: TransactionType.MERCHANT_HOLD,
  MERCHANT_RELEASE: TransactionType.MERCHANT_RELEASE,
  MERCHANT_FEES: TransactionType.MERCHANT_FEES,
  INCOME_SETTLEMENT_TO_MERCHANT: TransactionType.MERCHANT_INCOME_SETTLEMENT,
  LEGAL_ENTITY_SETTLEMENT: TransactionType.LEGAL_ENTITY_SETTLEMENT,
  LEGAL_ENTITY_DEPOSIT: TransactionType.LEGAL_ENTITY_DEPOSIT,
  LEGAL_ENTITY_DEDUCT: TransactionType.LEGAL_ENTITY_DEDUCT,
  PLE_SETTLEMENT: TransactionType.PLE_SETTLEMENT,
  PLE_DEPOSIT: TransactionType.PLE_DEPOSIT,
  PLE_EXPENSE_SETTLEMENT: TransactionType.PLE_EXPENSE_SETTLEMENT,
  PLE_EXPENSE_CHARGE: TransactionType.PLE_EXPENSE_CHARGE,
};
