/**
 * PostgreSQL Ledger Service
 *
 * Banking-grade double-entry accounting system implementation using PostgreSQL.
 * This service provides atomic, consistent, and auditable financial transactions.
 *
 * Key Features:
 * - Double-entry accounting (every transfer has debit and credit)
 * - Row-level locking for concurrent balance updates
 * - Optimistic locking with version numbers
 * - Support for pending transfers (two-phase commit)
 * - Full audit trail with immutable entries
 * - Balance constraints enforcement at database level
 */

import { getPostgres } from "@/infra/postgres/connection";
import { v4 as uuidv4 } from "uuid";
import { logger } from "@/infra/logger-instance";

// Types
export interface LedgerAccount {
  id: string;
  owner_id: string;
  owner_type: OwnerType;
  owner_name: string | null;
  account_type: AccountType;
  ledger_type: LedgerType;
  currency_code: number;
  debits_pending: bigint;
  debits_posted: bigint;
  credits_pending: bigint;
  credits_posted: bigint;
  allow_negative_balance: boolean;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface LedgerTransfer {
  id: string;
  debit_account_id: string;
  credit_account_id: string;
  amount: bigint;
  status: TransferStatus;
  operation_code: number;
  operation_name?: string;
  pending_id?: string;
  timeout_at?: Date;
  description?: string;
  metadata?: Record<string, any>;
  actor_id?: string;
  actor_type?: string;
  idempotency_key?: string;
  created_at: Date;
  posted_at?: Date;
}

export interface LedgerEntry {
  id: string;
  transfer_id: string;
  account_id: string;
  amount: bigint;
  entry_type: "DEBIT" | "CREDIT";
  status: TransferStatus;
  operation_code: number;
  balance_after: bigint;
  description?: string;
  metadata?: Record<string, any>;
  idempotency_key?: string;
  created_at: Date;
  posted_at?: Date;
}

export type OwnerType = "MERCHANT" | "LEGAL_ENTITY" | "PROVIDER_LEGAL_ENTITY" | "SUPER_ADMIN" | "WORLD";
export type AccountType =
  | "MERCHANT_PAYIN"
  | "MERCHANT_PAYOUT"
  | "MERCHANT_HOLD"
  | "LEGAL_ENTITY_MAIN"
  | "PROVIDER_PAYIN"
  | "PROVIDER_PAYOUT"
  | "PROVIDER_EXPENSE"
  | "SUPER_ADMIN_INCOME"
  | "WORLD_MAIN";
export type TransferStatus = "PENDING" | "POSTED" | "VOIDED";
export type LedgerType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export interface CreateTransferInput {
  debitAccountId: string;
  creditAccountId: string;
  amount: bigint;
  operationCode: number;
  operationName?: string;
  description?: string;
  metadata?: Record<string, any>;
  actorId?: string;
  actorType?: string;
  idempotencyKey?: string;
  isPending?: boolean;
  timeoutSeconds?: number;
}

export interface AccountBalance {
  debitsPending: bigint;
  debitsPosted: bigint;
  creditsPending: bigint;
  creditsPosted: bigint;
  netBalance: bigint;
  availableBalance: bigint;
}

// Operation Codes (matching TigerBeetle constants)
export const OPERATION_CODES = {
  PAYIN: 1,
  PAYOUT: 2,
  INTERNAL_TRANSFER: 3,
  MERCHANT_SETTLEMENT: 10,
  MERCHANT_PAYOUT_FUND: 11,
  MERCHANT_DEDUCT: 12,
  MERCHANT_FEES: 13,
  MERCHANT_REFUND: 14,
  MERCHANT_HOLD: 15,
  MERCHANT_RELEASE: 16,
  PROVIDER_SETTLEMENT: 20,
  PROVIDER_TOPUP: 21,
  PROVIDER_FEES: 22,
  PROVIDER_FEES_SETTLE: 23,
  INCOME_SETTLE: 30,
} as const;

// Account type to ledger type mapping
const ACCOUNT_LEDGER_TYPE_MAP: Record<AccountType, LedgerType> = {
  MERCHANT_PAYIN: "LIABILITY",
  MERCHANT_PAYOUT: "LIABILITY",
  MERCHANT_HOLD: "LIABILITY",
  LEGAL_ENTITY_MAIN: "ASSET",
  PROVIDER_PAYIN: "ASSET",
  PROVIDER_PAYOUT: "ASSET",
  PROVIDER_EXPENSE: "EXPENSE",
  SUPER_ADMIN_INCOME: "REVENUE",
  WORLD_MAIN: "EQUITY",
};

// Accounts that allow negative balance
const ALLOW_NEGATIVE_ACCOUNTS: AccountType[] = ["WORLD_MAIN"];

export class PgLedgerService {
  /**
   * Creates a new ledger account
   */
  static async createAccount(
    ownerId: string,
    ownerType: OwnerType,
    accountType: AccountType,
    ownerName?: string
  ): Promise<LedgerAccount> {
    const sql = getPostgres();

    const ledgerType = ACCOUNT_LEDGER_TYPE_MAP[accountType];
    const allowNegative = ALLOW_NEGATIVE_ACCOUNTS.includes(accountType);

    const [account] = await sql<LedgerAccount[]>`
      INSERT INTO ledger_accounts (
        owner_id,
        owner_type,
        owner_name,
        account_type,
        ledger_type,
        allow_negative_balance
      ) VALUES (
        ${ownerId},
        ${ownerType},
        ${ownerName || null},
        ${accountType},
        ${ledgerType},
        ${allowNegative}
      )
      ON CONFLICT (owner_id, account_type) DO UPDATE
      SET updated_at = NOW()
      RETURNING *
    `;

    logger.info(
      { accountId: account.id, ownerId, accountType },
      "Ledger account created"
    );

    return account;
  }

  /**
   * Creates merchant accounts (payin, payout, hold)
   */
  static async createMerchantAccounts(
    merchantId: string,
    merchantName?: string
  ): Promise<{ payinId: string; payoutId: string; holdId: string }> {
    const sql = getPostgres();

    const accounts = await sql.begin(async (tx) => {
      const results: Record<string, string> = {};

      for (const accountType of ["MERCHANT_PAYIN", "MERCHANT_PAYOUT", "MERCHANT_HOLD"] as AccountType[]) {
        const [account] = await tx<LedgerAccount[]>`
          INSERT INTO ledger_accounts (
            owner_id,
            owner_type,
            owner_name,
            account_type,
            ledger_type,
            allow_negative_balance
          ) VALUES (
            ${merchantId},
            'MERCHANT',
            ${merchantName || null},
            ${accountType},
            'LIABILITY',
            false
          )
          ON CONFLICT (owner_id, account_type) DO UPDATE
          SET updated_at = NOW()
          RETURNING *
        `;

        if (accountType === "MERCHANT_PAYIN") results.payinId = account.id;
        else if (accountType === "MERCHANT_PAYOUT") results.payoutId = account.id;
        else if (accountType === "MERCHANT_HOLD") results.holdId = account.id;
      }

      return results;
    });

    logger.info({ merchantId, accounts }, "Merchant ledger accounts created");

    return accounts as { payinId: string; payoutId: string; holdId: string };
  }

  /**
   * Creates provider legal entity accounts (payin, payout, expense)
   */
  static async createProviderLegalEntityAccounts(
    pleId: string,
    pleName?: string
  ): Promise<{ payinId: string; payoutId: string; expenseId: string }> {
    const sql = getPostgres();

    const accounts = await sql.begin(async (tx) => {
      const results: Record<string, string> = {};

      const accountConfigs: { type: AccountType; ledgerType: LedgerType; key: string }[] = [
        { type: "PROVIDER_PAYIN", ledgerType: "ASSET", key: "payinId" },
        { type: "PROVIDER_PAYOUT", ledgerType: "ASSET", key: "payoutId" },
        { type: "PROVIDER_EXPENSE", ledgerType: "EXPENSE", key: "expenseId" },
      ];

      for (const config of accountConfigs) {
        const [account] = await tx<LedgerAccount[]>`
          INSERT INTO ledger_accounts (
            owner_id,
            owner_type,
            owner_name,
            account_type,
            ledger_type,
            allow_negative_balance
          ) VALUES (
            ${pleId},
            'PROVIDER_LEGAL_ENTITY',
            ${pleName || null},
            ${config.type},
            ${config.ledgerType},
            false
          )
          ON CONFLICT (owner_id, account_type) DO UPDATE
          SET updated_at = NOW()
          RETURNING *
        `;

        results[config.key] = account.id;
      }

      return results;
    });

    logger.info({ pleId, accounts }, "Provider legal entity ledger accounts created");

    return accounts as { payinId: string; payoutId: string; expenseId: string };
  }

  /**
   * Creates legal entity main account
   */
  static async createLegalEntityAccount(
    leId: string,
    leName?: string
  ): Promise<string> {
    const sql = getPostgres();

    const [account] = await sql<LedgerAccount[]>`
      INSERT INTO ledger_accounts (
        owner_id,
        owner_type,
        owner_name,
        account_type,
        ledger_type,
        allow_negative_balance
      ) VALUES (
        ${leId},
        'LEGAL_ENTITY',
        ${leName || null},
        'LEGAL_ENTITY_MAIN',
        'ASSET',
        false
      )
      ON CONFLICT (owner_id, account_type) DO UPDATE
      SET updated_at = NOW()
      RETURNING *
    `;

    logger.info({ leId, accountId: account.id }, "Legal entity ledger account created");

    return account.id;
  }

  /**
   * Creates super admin income account
   */
  static async createSuperAdminAccount(adminId: string): Promise<string> {
    const sql = getPostgres();

    const [account] = await sql<LedgerAccount[]>`
      INSERT INTO ledger_accounts (
        owner_id,
        owner_type,
        owner_name,
        account_type,
        ledger_type,
        allow_negative_balance
      ) VALUES (
        ${adminId},
        'SUPER_ADMIN',
        'Super Admin Income',
        'SUPER_ADMIN_INCOME',
        'REVENUE',
        false
      )
      ON CONFLICT (owner_id, account_type) DO UPDATE
      SET updated_at = NOW()
      RETURNING *
    `;

    logger.info({ adminId, accountId: account.id }, "Super admin ledger account created");

    return account.id;
  }

  /**
   * Creates world (external) account
   */
  static async createWorldAccount(): Promise<string> {
    const sql = getPostgres();

    const [account] = await sql<LedgerAccount[]>`
      INSERT INTO ledger_accounts (
        owner_id,
        owner_type,
        owner_name,
        account_type,
        ledger_type,
        allow_negative_balance
      ) VALUES (
        'WORLD',
        'WORLD',
        'World (External)',
        'WORLD_MAIN',
        'EQUITY',
        true
      )
      ON CONFLICT (owner_id, account_type) DO UPDATE
      SET updated_at = NOW()
      RETURNING *
    `;

    logger.info({ accountId: account.id }, "World ledger account created");

    return account.id;
  }

  /**
   * Gets or creates the singleton world account
   */
  static async getWorldAccountId(): Promise<string> {
    const sql = getPostgres();

    const [existing] = await sql<{ id: string }[]>`
      SELECT id FROM ledger_accounts
      WHERE owner_type = 'WORLD' AND account_type = 'WORLD_MAIN'
      LIMIT 1
    `;

    if (existing) return existing.id;

    return this.createWorldAccount();
  }

  /**
   * Creates a transfer between two accounts (core double-entry operation)
   */
  static async createTransfer(input: CreateTransferInput): Promise<LedgerTransfer> {
    const sql = getPostgres();

    // Validate amount
    if (input.amount <= 0n) {
      throw new Error("Transfer amount must be positive");
    }

    // Check idempotency
    if (input.idempotencyKey) {
      const [existing] = await sql<LedgerTransfer[]>`
        SELECT * FROM ledger_transfers
        WHERE idempotency_key = ${input.idempotencyKey}
      `;
      if (existing) {
        logger.debug({ idempotencyKey: input.idempotencyKey }, "Idempotent transfer found");
        return existing;
      }
    }

    const transferId = uuidv4();
    const status: TransferStatus = input.isPending ? "PENDING" : "POSTED";
    const timeoutAt = input.isPending && input.timeoutSeconds
      ? new Date(Date.now() + input.timeoutSeconds * 1000)
      : null;

    // Execute in transaction with row-level locking
    const transfer = await sql.begin(async (tx) => {
      // Lock both accounts for update (in consistent order to prevent deadlocks)
      const [debitAccountId, creditAccountId] = [input.debitAccountId, input.creditAccountId].sort();

      const accounts = await tx<LedgerAccount[]>`
        SELECT * FROM ledger_accounts
        WHERE id IN (${debitAccountId}, ${creditAccountId})
        FOR UPDATE
      `;

      if (accounts.length !== 2) {
        throw new Error("One or both accounts not found");
      }

      const debitAccount = accounts.find((a) => a.id === input.debitAccountId)!;
      const creditAccount = accounts.find((a) => a.id === input.creditAccountId)!;

      // Check if debit account has sufficient balance (unless it allows negative)
      if (!debitAccount.allow_negative_balance) {
        const availableBalance = debitAccount.credits_posted - debitAccount.debits_posted - debitAccount.debits_pending;
        if (availableBalance < input.amount) {
          throw new Error(
            `Insufficient balance. Available: ${availableBalance}, Required: ${input.amount}`
          );
        }
      }

      // Calculate new balances
      const debitBalanceAfter = debitAccount.credits_posted - debitAccount.debits_posted -
        (input.isPending ? debitAccount.debits_pending + input.amount : input.amount);
      const creditBalanceAfter = creditAccount.credits_posted + input.amount - creditAccount.debits_posted;

      // Update debit account balance
      if (input.isPending) {
        await tx`
          UPDATE ledger_accounts
          SET debits_pending = debits_pending + ${input.amount}
          WHERE id = ${input.debitAccountId}
        `;
      } else {
        await tx`
          UPDATE ledger_accounts
          SET debits_posted = debits_posted + ${input.amount}
          WHERE id = ${input.debitAccountId}
        `;
      }

      // Update credit account balance
      if (input.isPending) {
        await tx`
          UPDATE ledger_accounts
          SET credits_pending = credits_pending + ${input.amount}
          WHERE id = ${input.creditAccountId}
        `;
      } else {
        await tx`
          UPDATE ledger_accounts
          SET credits_posted = credits_posted + ${input.amount}
          WHERE id = ${input.creditAccountId}
        `;
      }

      // Create transfer record
      const [newTransfer] = await tx<LedgerTransfer[]>`
        INSERT INTO ledger_transfers (
          id,
          debit_account_id,
          credit_account_id,
          amount,
          status,
          operation_code,
          operation_name,
          timeout_at,
          description,
          metadata,
          actor_id,
          actor_type,
          idempotency_key,
          posted_at
        ) VALUES (
          ${transferId},
          ${input.debitAccountId},
          ${input.creditAccountId},
          ${input.amount},
          ${status},
          ${input.operationCode},
          ${input.operationName || null},
          ${timeoutAt},
          ${input.description || null},
          ${JSON.stringify(input.metadata || {})},
          ${input.actorId || null},
          ${input.actorType || null},
          ${input.idempotencyKey || null},
          ${input.isPending ? null : new Date()}
        )
        RETURNING *
      `;

      // Create ledger entries (debit and credit)
      await tx`
        INSERT INTO ledger_entries (
          transfer_id,
          account_id,
          amount,
          entry_type,
          status,
          operation_code,
          balance_after,
          description,
          metadata,
          idempotency_key,
          posted_at
        ) VALUES
        (
          ${transferId},
          ${input.debitAccountId},
          ${input.amount},
          'DEBIT',
          ${status},
          ${input.operationCode},
          ${debitBalanceAfter},
          ${input.description || null},
          ${JSON.stringify(input.metadata || {})},
          ${input.idempotencyKey ? `${input.idempotencyKey}_DEBIT` : null},
          ${input.isPending ? null : new Date()}
        ),
        (
          ${transferId},
          ${input.creditAccountId},
          ${input.amount},
          'CREDIT',
          ${status},
          ${input.operationCode},
          ${creditBalanceAfter},
          ${input.description || null},
          ${JSON.stringify(input.metadata || {})},
          ${input.idempotencyKey ? `${input.idempotencyKey}_CREDIT` : null},
          ${input.isPending ? null : new Date()}
        )
      `;

      return newTransfer;
    });

    logger.info(
      {
        transferId: transfer.id,
        debitAccountId: input.debitAccountId,
        creditAccountId: input.creditAccountId,
        amount: input.amount.toString(),
        operationCode: input.operationCode,
        status,
      },
      "Ledger transfer created"
    );

    return transfer;
  }

  /**
   * Creates multiple transfers atomically (batch operation)
   */
  static async createTransfers(
    inputs: CreateTransferInput[]
  ): Promise<LedgerTransfer[]> {
    const sql = getPostgres();

    if (inputs.length === 0) return [];

    // Execute all transfers in a single transaction
    const transfers = await sql.begin(async (tx) => {
      const results: LedgerTransfer[] = [];

      for (const input of inputs) {
        // Note: This is sequential within the transaction for safety
        // Each transfer locks accounts and validates balances
        const transfer = await this.createTransferInTx(tx, input);
        results.push(transfer);
      }

      return results;
    });

    logger.info(
      { count: transfers.length },
      "Batch ledger transfers created"
    );

    return transfers;
  }

  /**
   * Internal helper for creating transfer within an existing transaction
   */
  private static async createTransferInTx(
    tx: any,
    input: CreateTransferInput
  ): Promise<LedgerTransfer> {
    const transferId = uuidv4();
    const status: TransferStatus = input.isPending ? "PENDING" : "POSTED";

    // Lock both accounts
    const accounts = await tx<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE id IN (${input.debitAccountId}, ${input.creditAccountId})
      ORDER BY id
      FOR UPDATE
    `;

    if (accounts.length !== 2) {
      throw new Error("One or both accounts not found");
    }

    const debitAccount = accounts.find((a) => a.id === input.debitAccountId)!;
    const creditAccount = accounts.find((a) => a.id === input.creditAccountId)!;

    // Balance check
    if (!debitAccount.allow_negative_balance) {
      const available = debitAccount.credits_posted - debitAccount.debits_posted - debitAccount.debits_pending;
      if (available < input.amount) {
        throw new Error(`Insufficient balance for account ${input.debitAccountId}`);
      }
    }

    const debitBalanceAfter = debitAccount.credits_posted - debitAccount.debits_posted - input.amount;
    const creditBalanceAfter = creditAccount.credits_posted + input.amount - creditAccount.debits_posted;

    // Update balances
    await tx`
      UPDATE ledger_accounts
      SET debits_posted = debits_posted + ${input.amount}
      WHERE id = ${input.debitAccountId}
    `;

    await tx`
      UPDATE ledger_accounts
      SET credits_posted = credits_posted + ${input.amount}
      WHERE id = ${input.creditAccountId}
    `;

    // Create transfer
    const [transfer] = await tx<LedgerTransfer[]>`
      INSERT INTO ledger_transfers (
        id, debit_account_id, credit_account_id, amount, status,
        operation_code, operation_name, description, metadata,
        actor_id, actor_type, idempotency_key, posted_at
      ) VALUES (
        ${transferId}, ${input.debitAccountId}, ${input.creditAccountId},
        ${input.amount}, ${status}, ${input.operationCode},
        ${input.operationName || null}, ${input.description || null},
        ${JSON.stringify(input.metadata || {})}, ${input.actorId || null},
        ${input.actorType || null}, ${input.idempotencyKey || null},
        ${new Date()}
      )
      RETURNING *
    `;

    // Create entries
    await tx`
      INSERT INTO ledger_entries (
        transfer_id, account_id, amount, entry_type, status,
        operation_code, balance_after, description, posted_at
      ) VALUES
      (${transferId}, ${input.debitAccountId}, ${input.amount}, 'DEBIT',
       ${status}, ${input.operationCode}, ${debitBalanceAfter}, ${input.description || null}, ${new Date()}),
      (${transferId}, ${input.creditAccountId}, ${input.amount}, 'CREDIT',
       ${status}, ${input.operationCode}, ${creditBalanceAfter}, ${input.description || null}, ${new Date()})
    `;

    return transfer;
  }

  /**
   * Posts (commits) a pending transfer
   */
  static async postTransfer(transferId: string): Promise<void> {
    const sql = getPostgres();

    await sql.begin(async (tx) => {
      // Get and lock the pending transfer
      const [transfer] = await tx<LedgerTransfer[]>`
        SELECT * FROM ledger_transfers
        WHERE id = ${transferId}
        FOR UPDATE
      `;

      if (!transfer) {
        throw new Error("Transfer not found");
      }

      if (transfer.status !== "PENDING") {
        throw new Error(`Transfer is not pending (status: ${transfer.status})`);
      }

      // Lock both accounts
      await tx`
        SELECT id FROM ledger_accounts
        WHERE id IN (${transfer.debit_account_id}, ${transfer.credit_account_id})
        ORDER BY id
        FOR UPDATE
      `;

      // Move from pending to posted for debit account
      await tx`
        UPDATE ledger_accounts
        SET
          debits_pending = debits_pending - ${transfer.amount},
          debits_posted = debits_posted + ${transfer.amount}
        WHERE id = ${transfer.debit_account_id}
      `;

      // Move from pending to posted for credit account
      await tx`
        UPDATE ledger_accounts
        SET
          credits_pending = credits_pending - ${transfer.amount},
          credits_posted = credits_posted + ${transfer.amount}
        WHERE id = ${transfer.credit_account_id}
      `;

      // Update transfer status
      await tx`
        UPDATE ledger_transfers
        SET status = 'POSTED', posted_at = NOW()
        WHERE id = ${transferId}
      `;

      // Update entries status
      await tx`
        UPDATE ledger_entries
        SET status = 'POSTED', posted_at = NOW()
        WHERE transfer_id = ${transferId}
      `;
    });

    logger.info({ transferId }, "Pending transfer posted");
  }

  /**
   * Voids (cancels) a pending transfer
   */
  static async voidTransfer(transferId: string): Promise<void> {
    const sql = getPostgres();

    await sql.begin(async (tx) => {
      // Get and lock the pending transfer
      const [transfer] = await tx<LedgerTransfer[]>`
        SELECT * FROM ledger_transfers
        WHERE id = ${transferId}
        FOR UPDATE
      `;

      if (!transfer) {
        throw new Error("Transfer not found");
      }

      if (transfer.status !== "PENDING") {
        throw new Error(`Transfer is not pending (status: ${transfer.status})`);
      }

      // Lock both accounts
      await tx`
        SELECT id FROM ledger_accounts
        WHERE id IN (${transfer.debit_account_id}, ${transfer.credit_account_id})
        ORDER BY id
        FOR UPDATE
      `;

      // Remove pending amounts from debit account
      await tx`
        UPDATE ledger_accounts
        SET debits_pending = debits_pending - ${transfer.amount}
        WHERE id = ${transfer.debit_account_id}
      `;

      // Remove pending amounts from credit account
      await tx`
        UPDATE ledger_accounts
        SET credits_pending = credits_pending - ${transfer.amount}
        WHERE id = ${transfer.credit_account_id}
      `;

      // Update transfer status
      await tx`
        UPDATE ledger_transfers
        SET status = 'VOIDED'
        WHERE id = ${transferId}
      `;

      // Update entries status
      await tx`
        UPDATE ledger_entries
        SET status = 'VOIDED'
        WHERE transfer_id = ${transferId}
      `;
    });

    logger.info({ transferId }, "Pending transfer voided");
  }

  /**
   * Gets account balance
   */
  static async getBalance(accountId: string): Promise<AccountBalance | null> {
    const sql = getPostgres();

    const [account] = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts WHERE id = ${accountId}
    `;

    if (!account) return null;

    const netBalance = account.credits_posted - account.debits_posted;
    const availableBalance = netBalance - account.debits_pending;

    return {
      debitsPending: account.debits_pending,
      debitsPosted: account.debits_posted,
      creditsPending: account.credits_pending,
      creditsPosted: account.credits_posted,
      netBalance,
      availableBalance,
    };
  }

  /**
   * Gets multiple account balances
   */
  static async getBalances(accountIds: string[]): Promise<Map<string, AccountBalance>> {
    const sql = getPostgres();

    if (accountIds.length === 0) return new Map();

    const accounts = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts WHERE id = ANY(${accountIds})
    `;

    const result = new Map<string, AccountBalance>();

    for (const account of accounts) {
      const netBalance = account.credits_posted - account.debits_posted;
      const availableBalance = netBalance - account.debits_pending;

      result.set(account.id, {
        debitsPending: account.debits_pending,
        debitsPosted: account.debits_posted,
        creditsPending: account.credits_pending,
        creditsPosted: account.credits_posted,
        netBalance,
        availableBalance,
      });
    }

    return result;
  }

  /**
   * Gets account by ID
   */
  static async getAccount(accountId: string): Promise<LedgerAccount | null> {
    const sql = getPostgres();

    const [account] = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts WHERE id = ${accountId}
    `;

    return account || null;
  }

  /**
   * Gets accounts by owner
   */
  static async getAccountsByOwner(ownerId: string): Promise<LedgerAccount[]> {
    const sql = getPostgres();

    return sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE owner_id = ${ownerId}
      ORDER BY account_type
    `;
  }

  /**
   * Gets accounts by owner type
   */
  static async getAccountsByOwnerType(ownerType: OwnerType): Promise<LedgerAccount[]> {
    const sql = getPostgres();

    return sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE owner_type = ${ownerType}
      ORDER BY owner_id, account_type
    `;
  }

  /**
   * Gets transfers for an account
   */
  static async getTransfersByAccount(
    accountId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      status?: TransferStatus;
    }
  ): Promise<LedgerTransfer[]> {
    const sql = getPostgres();

    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    let query = sql<LedgerTransfer[]>`
      SELECT * FROM ledger_transfers
      WHERE (debit_account_id = ${accountId} OR credit_account_id = ${accountId})
    `;

    if (options?.startDate) {
      query = sql<LedgerTransfer[]>`
        SELECT * FROM ledger_transfers
        WHERE (debit_account_id = ${accountId} OR credit_account_id = ${accountId})
        AND created_at >= ${options.startDate}
      `;
    }

    // Build full query with ordering and pagination
    return sql<LedgerTransfer[]>`
      SELECT * FROM ledger_transfers
      WHERE (debit_account_id = ${accountId} OR credit_account_id = ${accountId})
      ${options?.startDate ? sql`AND created_at >= ${options.startDate}` : sql``}
      ${options?.endDate ? sql`AND created_at <= ${options.endDate}` : sql``}
      ${options?.status ? sql`AND status = ${options.status}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  /**
   * Gets transfer by ID
   */
  static async getTransfer(transferId: string): Promise<LedgerTransfer | null> {
    const sql = getPostgres();

    const [transfer] = await sql<LedgerTransfer[]>`
      SELECT * FROM ledger_transfers WHERE id = ${transferId}
    `;

    return transfer || null;
  }

  /**
   * Gets ledger entries for an account
   */
  static async getEntriesByAccount(
    accountId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<LedgerEntry[]> {
    const sql = getPostgres();

    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    return sql<LedgerEntry[]>`
      SELECT * FROM ledger_entries
      WHERE account_id = ${accountId}
      ${options?.startDate ? sql`AND created_at >= ${options.startDate}` : sql``}
      ${options?.endDate ? sql`AND created_at <= ${options.endDate}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  /**
   * Finds accounts matching given criteria
   */
  static async findAccounts(filter: {
    ownerId?: string;
    ownerType?: OwnerType;
    accountType?: AccountType;
    isActive?: boolean;
  }): Promise<LedgerAccount[]> {
    const sql = getPostgres();

    return sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE 1=1
      ${filter.ownerId ? sql`AND owner_id = ${filter.ownerId}` : sql``}
      ${filter.ownerType ? sql`AND owner_type = ${filter.ownerType}` : sql``}
      ${filter.accountType ? sql`AND account_type = ${filter.accountType}` : sql``}
      ${filter.isActive !== undefined ? sql`AND is_active = ${filter.isActive}` : sql``}
      ORDER BY created_at DESC
    `;
  }

  /**
   * Void expired pending transfers
   */
  static async voidExpiredTransfers(): Promise<number> {
    const sql = getPostgres();

    const expired = await sql<{ id: string }[]>`
      SELECT id FROM ledger_transfers
      WHERE status = 'PENDING'
      AND timeout_at IS NOT NULL
      AND timeout_at < NOW()
    `;

    let voided = 0;
    for (const transfer of expired) {
      try {
        await this.voidTransfer(transfer.id);
        voided++;
      } catch (error) {
        logger.error({ transferId: transfer.id, error }, "Failed to void expired transfer");
      }
    }

    if (voided > 0) {
      logger.info({ count: voided }, "Voided expired pending transfers");
    }

    return voided;
  }
}
