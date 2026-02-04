export const TB_LEGAL_ENTITY_LEDGER = 1;

/* ============================================================
   OWNER TYPES
   ============================================================ */

export const OWNER_TYPE = {
  MERCHANT: 0x01,
  LEGAL_ENTITY: 0x02,
  PROVIDER: 0x03,
  SUPER_ADMIN: 0x04,
} as const;

export type OwnerType = keyof typeof OWNER_TYPE;

/* ============================================================
   CURRENCY (ISO 4217)
   ============================================================ */

export const CURRENCY = {
  INR: 356,
} as const;

/* ============================================================
   LEDGER ACCOUNT TYPES (SLUG → CODE)
   These codes are part of the TigerBeetle 128-bit ID
   DO NOT CHANGE ONCE LIVE
   ============================================================ */

export const ACCOUNT_TYPE = {
  // -------- MERCHANT --------
  MERCHANT_PAYIN: { slug: "MERCHANT:PAYIN", code: 0x0101 },
  MERCHANT_PAYOUT: { slug: "MERCHANT:PAYOUT", code: 0x0102 },
  MERCHANT_HOLD: { slug: "MERCHANT:HOLD", code: 0x0103 },

  // -------- LEGAL ENTITY --------
  LEGAL_ENTITY_MAIN: { slug: "LEGAL_ENTITY:MAIN", code: 0x0201 },

  // -------- PROVIDER LEGAL ENTITY --------
  PROVIDER_PAYIN: { slug: "PROVIDER:PAYIN", code: 0x0301 },
  PROVIDER_PAYOUT: { slug: "PROVIDER:PAYOUT", code: 0x0302 },
  PROVIDER_EXPENSE: { slug: "PROVIDER:EXPENSE", code: 0x0303 },

  // -------- SUPER ADMIN --------
  SUPER_ADMIN_INCOME: { slug: "SUPER_ADMIN:INCOME", code: 0x0401 },

  // -------- WORLD (EXTERNAL) --------
  WORLD: { slug: "WORLD:MAIN", code: 0x0501 },
} as const;

export type AccountTypeKey = keyof typeof ACCOUNT_TYPE;

// Account Flags (Keeping existing utility flags)
export const TB_ACCOUNT_FLAGS = {
  NONE: 0,
  LINKED: 1 << 0,
  DEBITS_MUST_NOT_EXCEED_CREDITS: 1 << 1,
  CREDITS_MUST_NOT_EXCEED_DEBITS: 1 << 2,
  HISTORY: 1 << 3,
} as const;

// Transfer Flags (Keeping existing utility flags)
export const TB_TRANSFER_FLAGS = {
  NONE: 0,
  LINKED: 1 << 0,
  PENDING: 1 << 1,
  POST_PENDING_TRANSFER: 1 << 2,
  VOID_PENDING_TRANSFER: 1 << 3,
  BALANCING_DEBIT: 1 << 4,
  BALANCING_CREDIT: 1 << 5,
} as const;
