// ledger.constant.ts
import { AccountType } from 'fintech-ledger';

// =====================================================
// ACCOUNT PURPOSES (single source of truth)
// =====================================================
export const ENTITY_ACCOUNT_TYPE = {
    PAYIN: 'PAYIN',
    PAYOUT: 'PAYOUT',
    HOLD: 'HOLD',
    BANK: 'BANK',
    INCOME: 'INCOME',
    EXPENSE: 'EXPENSE',
    WORLD: 'WORLD',
} as const;

// =====================================================
// ENTITY TYPES (who owns the account)
// =====================================================
export const ENTITY_TYPE = {
    MERCHANT: 'MERCHANT',
    PROVIDER: 'PROVIDER',
    LEGAL_ENTITY: 'LEGAL_ENTITY',
    INCOME: 'INCOME',
    WORLD: 'WORLD',
} as const;

// =====================================================
// DEFAULT ACCOUNT TYPE PER ENTITY (fallback only)
// =====================================================
export const ENTITY_DEFAULT_ACCOUNT_TYPE = {
    [ENTITY_TYPE.MERCHANT]: AccountType.LIABILITY,
    [ENTITY_TYPE.PROVIDER]: AccountType.ASSET, // kept as-is (your choice)
    [ENTITY_TYPE.LEGAL_ENTITY]: AccountType.EQUITY,
    [ENTITY_TYPE.INCOME]: AccountType.INCOME,
    [ENTITY_TYPE.WORLD]: AccountType.OFF_BALANCE,
} as const;

// =====================================================
// PURPOSE → ACCOUNT TYPE OVERRIDE (priority)
// =====================================================
export const PURPOSE_ACCOUNT_TYPE_OVERRIDE = {
    [ENTITY_ACCOUNT_TYPE.INCOME]: AccountType.INCOME,
    [ENTITY_ACCOUNT_TYPE.EXPENSE]: AccountType.EXPENSE,
    [ENTITY_ACCOUNT_TYPE.WORLD]: AccountType.OFF_BALANCE,
} as const;

// =====================================================
// ALLOWED PURPOSES PER ENTITY (validation + discovery)
// =====================================================
export const ENTITY_ALLOWED_ACCOUNT_PURPOSES = {
    MERCHANT: [
        ENTITY_ACCOUNT_TYPE.PAYIN,
        ENTITY_ACCOUNT_TYPE.PAYOUT,
        ENTITY_ACCOUNT_TYPE.HOLD,
    ],

    PROVIDER: [
        ENTITY_ACCOUNT_TYPE.PAYIN,
        ENTITY_ACCOUNT_TYPE.PAYOUT,
        ENTITY_ACCOUNT_TYPE.EXPENSE,
    ],

    LEGAL_ENTITY: [
        ENTITY_ACCOUNT_TYPE.BANK,
    ],

    INCOME: [
        ENTITY_ACCOUNT_TYPE.INCOME,
    ],

    WORLD: [
        ENTITY_ACCOUNT_TYPE.WORLD,
    ],
} as const;

// =====================================================
// TYPES
// =====================================================
export type LedgerAccountEntity = keyof typeof ENTITY_TYPE;
export type LedgerAccountPurpose = keyof typeof ENTITY_ACCOUNT_TYPE;
export type LedgerEntityId = string;
