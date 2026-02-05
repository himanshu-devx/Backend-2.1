export type AccountId = string;
export type LedgerEntryId = string;
export type Money = bigint | string;

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  OFF_BALANCE = 'OFF_BALANCE',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  LOCKED_INFLOW = 'LOCKED_INFLOW',
  LOCKED_OUTFLOW = 'LOCKED_OUTFLOW',
}

export interface LedgerEntry {
  id: LedgerEntryId;
  description: string; // Narration
  postedAt: Date | null;
  createdAt: Date;
  valueDate?: Date;

  idempotencyKey?: string;
  externalRef?: string;
  correlationId?: string;

  // Custom Context
  metadata?: any;

  status: 'POSTED' | 'PENDING' | 'VOID';
  lines: LedgerLine[];
}

export interface LedgerLine {
  accountId: AccountId;
  amount: Money;
}

export interface LedgerCommand {
  description: string;
  idempotencyKey?: string;
  valueDate?: Date;

  externalRef?: string;
  correlationId?: string;

  metadata?: any;

  lines: {
    accountId: AccountId;
    amount: Money;
  }[];
}

export interface Account {
  id: AccountId;
  code: string;
  type: AccountType;
  status: AccountStatus;

  parentId?: AccountId;
  isHeader: boolean;
  path?: string;

  ledgerBalance: Money;
  pendingBalance: Money;
  createdAt: Date;

  allowOverdraft: boolean;
  minBalance: Money;
}

export interface LedgerTransferRequest {
  narration: string;
  valueDate?: Date;
  idempotencyKey?: string;
  correlationId?: string;
  externalRef?: string;
  actorId?: string;
  metadata?: any;
  debits?: Array<{ accountId: AccountId; amount: Money }>;
  credits?: Array<{ accountId: AccountId; amount: Money }>;
  status?: 'POSTED' | 'PENDING';
}
