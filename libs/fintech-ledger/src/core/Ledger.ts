import { PostingEngine } from '../engine/PostingEngine';
import { LedgerWriter } from '../engine/LedgerWriter';
import { Pool } from 'pg';
import { Money } from '../utils/Money';
import {
  LedgerEntryId,
  LedgerEntry,
  LedgerTransferRequest,
  LedgerCommand,
  Account,
  AccountType,
  AccountStatus,
  CreateAccountInput,
} from '../api/types';
import { InvalidCommandError } from '../api/errors';
// import { dbProperties } from '../infra/postgres';
import { AuditService } from '../services/AuditService';

export interface AccountView {
  id: string;
  code: string;
  type: AccountType;
  status: AccountStatus;
  parentId?: string;
  isHeader: boolean;
  path?: string;
  createdAt: Date;
  allowOverdraft: boolean;
  minBalance: string;
  ledgerBalance: string;
  pendingBalance: string;
  rawLedgerBalance: string;
  rawPendingBalance: string;
  normalBalanceSide: 'DEBIT' | 'CREDIT';
}

/**
 * Ledger (Core)
 * The primary interface for Accounting operations.
 * Validates Transfers and posts them to the Engine.
 */
export type LedgerDisplayMode = 'normalized' | 'raw';

export interface LedgerOptions {
  displayMode?: LedgerDisplayMode;
}

export class Ledger {
  private engine: PostingEngine;
  private pool: Pool;
  private displayMode: LedgerDisplayMode;

  constructor(pool?: Pool, options: LedgerOptions = {}) {
    this.pool = pool || new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      ssl: {
        rejectUnauthorized: false
      }
    });
    this.displayMode = options.displayMode || 'normalized';
    const writer = new LedgerWriter();
    this.engine = new PostingEngine(this.pool, writer);
  }

  // --- Account Management ---

  async createAccount(input: CreateAccountInput): Promise<void> {
    Money.assertRupeesInput(input.minBalance ?? '0', 'minBalance');
    await this.engine.createAccount(
      input.id,
      input.code,
      input.type,
      input.allowOverdraft ?? false,
      input.parentId,
      input.isHeader ?? false,
      input.status ?? AccountStatus.ACTIVE,
      input.minBalance ?? '0'
    );
    await AuditService.log('CREATE_ACCOUNT', input.id, input.actorId ?? 'system', {
      code: input.code,
      type: input.type,
      allowOverdraft: input.allowOverdraft,
      parentId: input.parentId,
      isHeader: input.isHeader,
      status: input.status,
      minBalance: input.minBalance?.toString(),
    });
  }

  async updateAccount(
    id: string,
    updates: {
      status?: AccountStatus;
      allowOverdraft?: boolean;
      minBalance?: string | number;
      type?: AccountType;
    },
    actorId = 'system'
  ): Promise<void> {
    if (updates.minBalance !== undefined) {
      Money.assertRupeesInput(updates.minBalance, 'minBalance');
    }
    await this.engine.updateAccount(id, {
      status: updates.status,
      allowOverdraft: updates.allowOverdraft,
      minBalance: updates.minBalance !== undefined ? updates.minBalance : undefined,
      type: updates.type
    });
    await AuditService.log('UPDATE_ACCOUNT', id, actorId, updates);
  }

  async getAccount(id: string): Promise<AccountView> {
    const acc: Account = await this.engine.getAccount(id);
    return this.mapAccount(acc);
  }

  async getAccounts(ids: string[]): Promise<AccountView[]> {
    const accounts = await this.engine.getAccounts(ids);
    return accounts.map((acc) => this.mapAccount(acc));
  }

  async searchAccounts(pattern: string): Promise<AccountView[]> {
    const accounts = await this.engine.searchAccounts(pattern);
    return accounts.map((acc) => this.mapAccount(acc));
  }

  async getAllAccounts(): Promise<AccountView[]> {
    const accounts = await this.engine.getAllAccounts();
    return accounts.map((acc) => this.mapAccount(acc));
  }

  // --- Reporting ---

  async getEntries(accountId: string, options: any = {}): Promise<any[]> {
    const txs = await this.engine.getEntries(accountId, options);
    const accountTypes = await this.engine.getAccountTypes(
      Array.from(new Set(txs.flatMap((t) => t.lines.map((l) => l.accountId)))),
    );
    return txs.map((t: LedgerEntry) => ({
      id: t.id,
      description: t.description,
      posted_at: t.postedAt,
      status: t.status,
      lines: t.lines.map(l => ({
        accountId: l.accountId,
        amount: this.toRupees(
          this.normalizeDisplayBalance(accountTypes.get(l.accountId), Money.toPaisa(l.amount as any)),
        ),
        rawAmount: this.toRupees(Money.toPaisa(l.amount as any)),
        normalBalanceSide: this.normalBalanceSide(accountTypes.get(l.accountId)),
      })),
      metadata: t.metadata
    }));
  }

  async getEntry(entryId: LedgerEntryId): Promise<any> {
    const tx = await this.engine.getEntry(entryId);
    if (!tx) return null;
    const accountTypes = await this.engine.getAccountTypes(
      Array.from(new Set(tx.lines.map((l) => l.accountId))),
    );
    return {
      id: tx.id,
      description: tx.description,
      posted_at: tx.postedAt,
      status: tx.status,
      lines: tx.lines.map(l => ({
        accountId: l.accountId,
        amount: this.toRupees(
          this.normalizeDisplayBalance(accountTypes.get(l.accountId), Money.toPaisa(l.amount as any)),
        ),
        rawAmount: this.toRupees(Money.toPaisa(l.amount as any)),
        normalBalanceSide: this.normalBalanceSide(accountTypes.get(l.accountId)),
      })),
      metadata: tx.metadata
    };
  }

  // --- Transactions ---

  /**
   * Create a Ledger Transfer (Multi-Leg).
   * Supports Debits/Credits, Autos-balancing check, and Status.
   */
  async transfer(request: LedgerTransferRequest): Promise<string> {
    // 1. Validate & Normalize
    const {
      debits,
      credits,
      narration,
      externalRef,
      status = 'POSTED',
      idempotencyKey,
      correlationId,
      valueDate,
      metadata,
      actorId = 'system',
    } = request;

    const lines: Array<{ accountId: string; amount: string }> = [];
    let balanceCheck = 0n;

    // Process Debits (Positive Logic: Debit = +Amount)
    if (debits && debits.length > 0) {
      for (const d of debits) {
        Money.assertRupeesInput(d.amount, 'debit.amount');
        const amt = Money.toPaisa(d.amount as any);
        if (amt === 0n) throw new InvalidCommandError('Debit amount cannot be 0');
        lines.push({ accountId: d.accountId, amount: Money.normalizeRupees(d.amount as any) });
        balanceCheck += amt;
      }
    }

    // Process Credits (Negative Logic: Credit = -Amount)
    if (credits && credits.length > 0) {
      for (const c of credits) {
        Money.assertRupeesInput(c.amount, 'credit.amount');
        const amt = Money.toPaisa(c.amount as any);
        if (amt === 0n) throw new InvalidCommandError('Credit amount cannot be 0');
        lines.push({ accountId: c.accountId, amount: Money.negateRupees(c.amount as any) });
        balanceCheck -= amt;
      }
    }

    if (lines.length === 0) {
      throw new InvalidCommandError('Transfer must include at least one debit or credit line');
    }

    if (balanceCheck !== 0n) {
      throw new Error(`Transaction Unbalanced. Difference: ${balanceCheck}`);
    }

    const cmd: LedgerCommand = {
      description: narration,
      externalRef,
      idempotencyKey,
      correlationId,
      valueDate,
      metadata,
      lines,
    };

    if (status === 'POSTED') {
      const entryId = await this.engine.createPosted(cmd);
      await AuditService.log('TRANSFER_POSTED', entryId, actorId, {
        narration,
        externalRef,
        idempotencyKey,
        correlationId,
        valueDate,
        metadata,
        lines,
      });
      return entryId;
    } else {
      const entryId = await this.engine.createPending(cmd);
      await AuditService.log('TRANSFER_PENDING', entryId, actorId, {
        narration,
        externalRef,
        idempotencyKey,
        correlationId,
        valueDate,
        metadata,
        lines,
      });
      return entryId;
    }
  }

  /**
   * Batch transfer API for multi-entry commits (single transaction).
   */
  async transferBatch(requests: LedgerTransferRequest[]): Promise<string[]> {
    if (!requests || requests.length === 0) return [];
    const commands: LedgerCommand[] = [];
    const auditPayloads: Array<{ actorId: string; entryId?: string; status: 'POSTED' | 'PENDING'; cmd: LedgerCommand; lines: any[] }> = [];

    for (const request of requests) {
      const {
        debits,
        credits,
        narration,
        externalRef,
        status = 'POSTED',
        idempotencyKey,
        correlationId,
        valueDate,
        metadata,
        actorId = 'system',
      } = request;

      const lines: Array<{ accountId: string; amount: string }> = [];
      let balanceCheck = 0n;

      if (debits && debits.length > 0) {
        for (const d of debits) {
          Money.assertRupeesInput(d.amount, 'debit.amount');
          const amt = Money.toPaisa(d.amount as any);
          if (amt === 0n) throw new InvalidCommandError('Debit amount cannot be 0');
          lines.push({ accountId: d.accountId, amount: Money.normalizeRupees(d.amount as any) });
          balanceCheck += amt;
        }
      }

      if (credits && credits.length > 0) {
        for (const c of credits) {
          Money.assertRupeesInput(c.amount, 'credit.amount');
          const amt = Money.toPaisa(c.amount as any);
          if (amt === 0n) throw new InvalidCommandError('Credit amount cannot be 0');
          lines.push({ accountId: c.accountId, amount: Money.negateRupees(c.amount as any) });
          balanceCheck -= amt;
        }
      }

      if (lines.length === 0) {
        throw new InvalidCommandError('Transfer must include at least one debit or credit line');
      }

      if (balanceCheck !== 0n) {
        throw new Error(`Transaction Unbalanced. Difference: ${balanceCheck}`);
      }

      const cmd: LedgerCommand = {
        description: narration,
        externalRef,
        idempotencyKey,
        correlationId,
        valueDate,
        metadata,
        lines,
      };

      commands.push(cmd);
      auditPayloads.push({ actorId, status, cmd, lines });
    }

    const allPosted = auditPayloads.every((p) => p.status === 'POSTED');
    const allPending = auditPayloads.every((p) => p.status === 'PENDING');
    if (!allPosted && !allPending) {
      throw new InvalidCommandError('Batch transfer must use a single status (all POSTED or all PENDING)');
    }
    const ids = allPosted
      ? await this.engine.createPostedBatch(commands)
      : await this.engine.createPendingBatch(commands);

    for (let i = 0; i < ids.length; i++) {
      const payload = auditPayloads[i];
      await AuditService.log(
        payload.status === 'POSTED' ? 'TRANSFER_POSTED' : 'TRANSFER_PENDING',
        ids[i],
        payload.actorId,
        {
          description: payload.cmd.description,
          externalRef: payload.cmd.externalRef,
          idempotencyKey: payload.cmd.idempotencyKey,
          correlationId: payload.cmd.correlationId,
          valueDate: payload.cmd.valueDate,
          metadata: payload.cmd.metadata,
          lines: payload.lines,
        },
      );
    }

    return ids;
  }

  /**
   * Settle a Pending Entry (Capture).
   */
  async post(entryId: LedgerEntryId, actorId = 'system'): Promise<void> {
    await this.engine.post(entryId);
    await AuditService.log('POST_ENTRY', entryId, actorId, {});
  }

  async postBatch(entryIds: LedgerEntryId[], actorId = 'system'): Promise<void> {
    if (!entryIds || entryIds.length === 0) return;
    await this.engine.postBatch(entryIds);
    for (const entryId of entryIds) {
      await AuditService.log('POST_ENTRY', entryId, actorId, {});
    }
  }

  /**
   * Void a Pending Entry.
   */
  async void(entryId: LedgerEntryId, actorId = 'system'): Promise<void> {
    await this.engine.void(entryId);
    await AuditService.log('VOID_ENTRY', entryId, actorId, {});
  }

  async voidBatch(entryIds: LedgerEntryId[], actorId = 'system'): Promise<void> {
    if (!entryIds || entryIds.length === 0) return;
    await this.engine.voidBatch(entryIds);
    for (const entryId of entryIds) {
      await AuditService.log('VOID_ENTRY', entryId, actorId, {});
    }
  }

  /**
   * Reverse a posted entry by creating a new inverse entry.
   */
  async reverse(entryId: LedgerEntryId, actorId = 'system'): Promise<string> {
    const revId = await this.engine.reverse(entryId);
    await AuditService.log('REVERSE_ENTRY', revId, actorId, { originalEntryId: entryId });
    return revId;
  }

  /**
   * Get Balance in Rupees ("10.50").
   */
  async getBalance(accountId: string): Promise<string> {
    const acc = await this.engine.getAccount(accountId);
    const display = this.normalizeDisplayBalance(acc.type, Money.toPaisa(acc.ledgerBalance as any));
    return this.toRupees(display);
  }

  /**
   * Get Ledger + Pending balances in Rupees.
   */
  async getBalances(accountId: string): Promise<{ ledger: string; pending: string }> {
    const acc = await this.engine.getAccount(accountId);
    const ledger = this.normalizeDisplayBalance(acc.type, Money.toPaisa(acc.ledgerBalance as any));
    const pending = this.normalizeDisplayBalance(acc.type, Money.toPaisa(acc.pendingBalance as any));
    return {
      ledger: this.toRupees(ledger),
      pending: this.toRupees(pending),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapAccount(acc: Account): AccountView {
    const rawLedger = Money.toPaisa(acc.ledgerBalance as any);
    const rawPending = Money.toPaisa(acc.pendingBalance as any);
    const displayLedger = this.normalizeDisplayBalance(acc.type, rawLedger);
    const displayPending = this.normalizeDisplayBalance(acc.type, rawPending);
    return {
      id: acc.id,
      code: acc.code,
      type: acc.type,
      status: acc.status,
      parentId: acc.parentId,
      isHeader: acc.isHeader,
      path: acc.path,
      createdAt: acc.createdAt,
      allowOverdraft: acc.allowOverdraft,
      minBalance: this.toRupees(Money.toPaisa(acc.minBalance as any)),
      ledgerBalance: this.toRupees(displayLedger),
      pendingBalance: this.toRupees(displayPending),
      rawLedgerBalance: this.toRupees(rawLedger),
      rawPendingBalance: this.toRupees(rawPending),
      normalBalanceSide: this.normalBalanceSide(acc.type),
    };
  }

  private toRupees(amount: string | number | bigint): string {
    if (typeof amount === 'bigint') {
      return Money.toRupees(amount);
    }
    return Money.normalizeRupees(amount);
  }

  private normalizeDisplayBalance(type: AccountType | undefined, amount: bigint): bigint {
    if (this.displayMode === 'raw') return amount;
    if (!type) return amount;
    switch (type) {
      case AccountType.ASSET:
      case AccountType.EXPENSE:
      case AccountType.OFF_BALANCE:
        return amount;
      case AccountType.LIABILITY:
      case AccountType.EQUITY:
      case AccountType.INCOME:
        return -amount;
      default:
        return amount;
    }
  }

  private normalBalanceSide(type: AccountType | undefined): 'DEBIT' | 'CREDIT' {
    if (!type) return 'DEBIT';
    switch (type) {
      case AccountType.ASSET:
      case AccountType.EXPENSE:
      case AccountType.OFF_BALANCE:
        return 'DEBIT';
      case AccountType.LIABILITY:
      case AccountType.EQUITY:
      case AccountType.INCOME:
        return 'CREDIT';
      default:
        return 'DEBIT';
    }
  }
}
