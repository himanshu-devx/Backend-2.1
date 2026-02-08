import { Pool, PoolClient } from 'pg';
import { LedgerCommand, LedgerEntryId, LedgerEntry, AccountId, Account, AccountType } from '../api/types';
import { LedgerWriter } from './LedgerWriter';
import { getLockOrder } from './LockOrdering';
import { runAtomic } from '../infra/atomic';
import { emitEntryPosted } from './LedgerEvents';

export class PostingEngine {
  constructor(private pool: Pool, private writer: LedgerWriter) {
  }

  /**
   * Creates an entry that is immediately POSTED.
   * Useful for direct transfers where PENDING state is not needed.
   */
  async createPosted(cmd: LedgerCommand): Promise<LedgerEntryId> {
    return runAtomic(async (client: PoolClient) => {
      // Commit as POSTED (true)
      const id = await this.writer.commitEntry(client, cmd, true);

      emitEntryPosted({
        entryId: id,
        description: cmd.description,
        externalRef: cmd.externalRef,
        lines: cmd.lines.map((l) => ({
          accountId: l.accountId,
          amount: typeof l.amount === 'bigint' ? l.amount : BigInt(l.amount),
        })),
      });
      return id;
    });
  }

  /**
   * Creates multiple POSTED entries in a single transaction.
   */
  async createPostedBatch(commands: LedgerCommand[]): Promise<LedgerEntryId[]> {
    return runAtomic(async (client: PoolClient) => {
      const ids: LedgerEntryId[] = [];
      for (const cmd of commands) {
        const id = await this.writer.commitEntry(client, cmd, true);
        emitEntryPosted({
          entryId: id,
          description: cmd.description,
          externalRef: cmd.externalRef,
          lines: cmd.lines.map((l) => ({
            accountId: l.accountId,
            amount: typeof l.amount === 'bigint' ? l.amount : BigInt(l.amount),
          })),
        });
        ids.push(id);
      }
      return ids;
    });
  }

  /**
   * Creates multiple PENDING entries in a single transaction.
   */
  async createPendingBatch(commands: LedgerCommand[]): Promise<LedgerEntryId[]> {
    return runAtomic(async (client: PoolClient) => {
      const ids: LedgerEntryId[] = [];
      for (const cmd of commands) {
        const id = await this.writer.commitEntry(client, cmd, false);
        ids.push(id);
      }
      return ids;
    });
  }

  /**
   * Creates an entry that is PENDING.
   * Requires a subsequent POST to finalize.
   */
  async createPending(cmd: LedgerCommand): Promise<LedgerEntryId> {
    return runAtomic(async (client: PoolClient) => {
      // Commit as PENDING (false)
      const id = await this.writer.commitEntry(client, cmd, false);
      return id;
    });
  }

  /**
   * Posts a previously PENDING entry.
   * Finalizes the transaction and updates ledger balances.
   */
  async post(entryId: LedgerEntryId): Promise<void> {
    return runAtomic(async (client: PoolClient) => {
      // 1. Fetch entry
      const res = await client.query({
        name: 'ledger_entry_for_update',
        text: `SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`,
        values: [entryId],
      });
      if (res.rowCount === 0) throw new Error('Entry not found');

      const entry = res.rows[0];
      if (entry.status !== 'PENDING') {
        throw new Error(`Entry is ${entry.status}, cannot POST.`);
      }

      // 2. Fetch lines
      const lineRes = await client.query({
        name: 'ledger_lines_by_entry',
        text: `SELECT id, account_id, amount FROM journal_lines WHERE entry_id = $1`,
        values: [entryId],
      });
      const lines = lineRes.rows.map((r: { id: string; account_id: string; amount: string }) => ({
        id: r.id,
        accountId: r.account_id,
        amount: BigInt(r.amount),
      }));

      // 3. Lock Accounts in Order (Batch Lock)
      const accountIds = getLockOrder(lines.map((l: any) => l.accountId));
      const statusMap = await getLockOrder(
        lines.map((l: any) => l.accountId),
      );

      // Check Status
      if (Array.from(statusMap.values()).includes('FROZEN')) {
        throw new Error('Entry involves FROZEN account');
      }

      // 4. Update Balances
      // Move from Pending to Ledger
      const accountsRes = await client.query({
        name: 'ledger_accounts_for_update',
        text: `SELECT id, ledger_balance FROM accounts WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
        values: [accountIds],
      });
      const runningLedger = new Map<string, bigint>();
      for (const row of accountsRes.rows) {
        runningLedger.set(row.id, BigInt(row.ledger_balance));
      }

      for (const line of lines) {
        await client.query({
          name: 'ledger_move_pending_to_ledger',
          text: `UPDATE accounts SET
                  pending_balance = pending_balance - $1,
                  ledger_balance = ledger_balance + $1
                 WHERE id = $2`,
          values: [line.amount, line.accountId],
        });

        const current = runningLedger.get(line.accountId) || 0n;
        const next = current + line.amount;
        runningLedger.set(line.accountId, next);
        await client.query({
          name: 'ledger_update_line_balance_after',
          text: `UPDATE journal_lines SET balance_after = $1 WHERE id = $2`,
          values: [next, line.id],
        });
      }

      // 5. Update Entry Status
      await client.query({
        name: 'ledger_mark_entry_posted',
        text: `UPDATE journal_entries SET status = 'POSTED', posted_at = NOW() WHERE id = $1`,
        values: [entryId],
      });

      emitEntryPosted({
        entryId,
        description: entry.description,
        externalRef: entry.external_ref || undefined,
        lines,
      });
    });
  }

  /**
   * Posts multiple pending entries in a single transaction.
   */
  async postBatch(entryIds: LedgerEntryId[]): Promise<void> {
    if (entryIds.length === 0) return;
    return runAtomic(async (client: PoolClient) => {
      for (const entryId of entryIds) {
        // 1. Fetch entry
        const res = await client.query({
          name: 'ledger_entry_for_update',
          text: `SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`,
          values: [entryId],
        });
        if (res.rowCount === 0) throw new Error('Entry not found');

        const entry = res.rows[0];
        if (entry.status !== 'PENDING') {
          throw new Error(`Entry is ${entry.status}, cannot POST.`);
        }

        // 2. Fetch lines
        const lineRes = await client.query({
          name: 'ledger_lines_by_entry',
          text: `SELECT id, account_id, amount FROM journal_lines WHERE entry_id = $1`,
          values: [entryId],
        });
        const lines = lineRes.rows.map((r: { id: string; account_id: string; amount: string }) => ({
          id: r.id,
          accountId: r.account_id,
          amount: BigInt(r.amount),
        }));

        // 3. Lock Accounts in Order (Batch Lock)
        const accountIds = getLockOrder(lines.map((l: any) => l.accountId));
        const statusMap = await getLockOrder(
          lines.map((l: any) => l.accountId),
        );

        if (Array.from(statusMap.values()).includes('FROZEN')) {
          throw new Error('Entry involves FROZEN account');
        }

        // 4. Update Balances
        const accountsRes = await client.query({
          name: 'ledger_accounts_for_update',
          text: `SELECT id, ledger_balance FROM accounts WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
          values: [accountIds],
        });
        const runningLedger = new Map<string, bigint>();
        for (const row of accountsRes.rows) {
          runningLedger.set(row.id, BigInt(row.ledger_balance));
        }

        for (const line of lines) {
          await client.query({
            name: 'ledger_move_pending_to_ledger',
            text: `UPDATE accounts SET
                    pending_balance = pending_balance - $1,
                    ledger_balance = ledger_balance + $1
                   WHERE id = $2`,
            values: [line.amount, line.accountId],
          });

          const current = runningLedger.get(line.accountId) || 0n;
          const next = current + line.amount;
          runningLedger.set(line.accountId, next);
          await client.query({
            name: 'ledger_update_line_balance_after',
            text: `UPDATE journal_lines SET balance_after = $1 WHERE id = $2`,
            values: [next, line.id],
          });
        }

        // 5. Update Entry Status
        await client.query({
          name: 'ledger_mark_entry_posted',
          text: `UPDATE journal_entries SET status = 'POSTED', posted_at = NOW() WHERE id = $1`,
          values: [entryId],
        });

        emitEntryPosted({
          entryId,
          description: entry.description,
          externalRef: entry.external_ref || undefined,
          lines,
        });
      }
    });
  }

  /**
   * Reverses a posted entry by creating a new inverse entry.
   */
  async reverse(entryId: LedgerEntryId): Promise<LedgerEntryId> {
    return runAtomic(async (client: PoolClient) => {
      // 1. Get Original Entry
      const entryRes = await client.query({
        name: 'ledger_entry_by_id',
        text: `SELECT * FROM journal_entries WHERE id = $1`,
        values: [entryId],
      });
      if (entryRes.rowCount === 0) throw new Error('Entry not found');
      const originalEntry = entryRes.rows[0];

      // 2. Fetch Lines
      const linesRes = await client.query({
        name: 'ledger_lines_for_reverse',
        text: `SELECT * FROM journal_lines WHERE entry_id = $1`,
        values: [entryId],
      });
      const lines = linesRes.rows;

      // 3. Create Inverted Command
      const command: LedgerCommand = {
        description: `Reversal of ${originalEntry.description} (Ref: ${entryId})`,
        correlationId: entryId,
        lines: lines.map((l: { account_id: string; amount: string }) => ({
          accountId: l.account_id,
          amount: -BigInt(l.amount), // Invert Amount (Keep as BigInt for internal logic, usually Command expects Money(string|bigint))
        })),
      };

      // 4. Commit as new Posted Entry
      const revId = await this.writer.commitEntry(client, command, true);

      emitEntryPosted({
        entryId: revId,
        description: command.description,
        externalRef: command.externalRef,
        lines: command.lines.map((l) => ({
          accountId: l.accountId,
          amount: typeof l.amount === 'bigint' ? l.amount : BigInt(l.amount),
        })),
      });

      return revId;
    });
  }

  /**
   * Voids a PENDING entry.
   * Reverts the pending_balance reservation.
   */
  async void(entryId: LedgerEntryId): Promise<void> {
    return runAtomic(async (client: PoolClient) => {
      // 1. Fetch entry
      const res = await client.query({
        name: 'ledger_entry_for_void',
        text: `SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`,
        values: [entryId],
      });
      if (res.rowCount === 0) throw new Error('Entry not found');
      const entry = res.rows[0];

      if (entry.status !== 'PENDING') {
        throw new Error(`Cannot void entry with status: ${entry.status}`);
      }

      // 2. Fetch original lines
      const linesRes = await client.query({
        name: 'ledger_lines_for_void',
        text: `SELECT * FROM journal_lines WHERE entry_id = $1`,
        values: [entryId],
      });
      const lines = linesRes.rows;

      // 3. Revert Pending Balances (Locking accounts first)
      const accountIds = lines.map((l: { account_id: string }) => l.account_id);

      // Ensure we lock them safely
      await getLockOrder(accountIds);

      // We need to decrease pending_balance (since it was increased on creation)
      for (const line of lines) {
        // If amount was positive (Credit/Debit depending on perspective), we subtract it.
        // LedgerWriter added command.amount to pending_balance. So we subtract command.amount.
        await client.query({
          name: 'ledger_void_pending_balance',
          text: `UPDATE accounts SET pending_balance = pending_balance - $1 WHERE id = $2`,
          values: [BigInt(line.amount), line.account_id],
        });
      }

      // 4. Update Status
      await client.query({
        name: 'ledger_mark_entry_void',
        text: `UPDATE journal_entries SET status = 'VOID' WHERE id = $1`,
        values: [entryId],
      });
    });
  }

  /**
   * Voids multiple pending entries in a single transaction.
   */
  async voidBatch(entryIds: LedgerEntryId[]): Promise<void> {
    if (entryIds.length === 0) return;
    return runAtomic(async (client: PoolClient) => {
      for (const entryId of entryIds) {
        const res = await client.query({
          name: 'ledger_entry_for_void',
          text: `SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`,
          values: [entryId],
        });
        if (res.rowCount === 0) throw new Error('Entry not found');
        const entry = res.rows[0];

        if (entry.status !== 'PENDING') {
          throw new Error(`Cannot void entry with status: ${entry.status}`);
        }

        const linesRes = await client.query({
          name: 'ledger_lines_for_void',
          text: `SELECT * FROM journal_lines WHERE entry_id = $1`,
          values: [entryId],
        });
        const lines = linesRes.rows;

        const accountIds = lines.map((l: { account_id: string }) => l.account_id);
        await getLockOrder(accountIds);

        for (const line of lines) {
          await client.query({
            name: 'ledger_void_pending_balance',
            text: `UPDATE accounts SET pending_balance = pending_balance - $1 WHERE id = $2`,
            values: [BigInt(line.amount), line.account_id],
          });
        }

        await client.query({
          name: 'ledger_mark_entry_void',
          text: `UPDATE journal_entries SET status = 'VOID' WHERE id = $1`,
          values: [entryId],
        });
      }
    });
  }

  // --- Read Methods ---

  async getEntry(entryId: LedgerEntryId): Promise<LedgerEntry | null> {
    const res = await this.pool.query(`SELECT * FROM journal_entries WHERE id = $1`, [entryId]);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];

    // Fetch lines
    const lRes = await this.pool.query(`SELECT * FROM journal_lines WHERE entry_id = $1`, [entryId]);

    return {
      id: r.id,
      description: r.description,
      postedAt: r.posted_at ? new Date(r.posted_at) : null,
      createdAt: new Date(r.created_at),
      status: r.status,
      lines: lRes.rows.map((l: any) => ({
        accountId: l.account_id,
        amount: BigInt(l.amount)
      })),
      metadata: r.metadata
    };
  }

  async getEntries(accountId: string, options: { limit?: number } = {}): Promise<LedgerEntry[]> {
    const res = await this.pool.query(
      `SELECT DISTINCT e.* FROM journal_entries e
           JOIN journal_lines l ON l.entry_id = e.id
           WHERE l.account_id = $1
           ORDER BY e.posted_at DESC
           LIMIT $2`,
      [accountId, options.limit || 50]
    );

    // Note: This is a simple implementation. Ideally we batch fetch lines.
    const entries: LedgerEntry[] = [];
    for (const r of res.rows) {
      const lRes = await this.pool.query(`SELECT * FROM journal_lines WHERE entry_id = $1`, [r.id]);
      entries.push({
        id: r.id,
        description: r.description,
        postedAt: r.posted_at ? new Date(r.posted_at) : null,
        createdAt: new Date(r.created_at),
        status: r.status,
        lines: lRes.rows.map((l: any) => ({
          accountId: l.account_id,
          amount: BigInt(l.amount)
        })),
        metadata: r.metadata
      });
    }
    return entries;
  }

  async getBalance(accountId: AccountId): Promise<{ ledger: bigint; pending: bigint }> {
    const res = await this.pool.query(`SELECT ledger_balance, pending_balance FROM accounts WHERE id = $1`, [
      accountId,
    ]);
    if (res.rowCount === 0) throw new Error('Account not found');
    return {
      ledger: BigInt(res.rows[0].ledger_balance),
      pending: BigInt(res.rows[0].pending_balance),
    };
  }

  // Debug/Admin Tool
  async rebuildAccountBalance(accountId: AccountId): Promise<{ old: string; new: string; diff: string }> {
    return runAtomic(async (client: PoolClient) => {
      // 1. Get current
      const accRes = await client.query(`SELECT ledger_balance FROM accounts WHERE id = $1 FOR UPDATE`, [accountId]);
      const oldBalance = BigInt(accRes.rows[0].ledger_balance);

      // 2. Sum Posted Lines (Simple sum, might be heavy for large accounts)
      const sumRes = await client.query(`
          SELECT SUM(amount) as total 
          FROM journal_lines l
          JOIN journal_entries e ON l.entry_id = e.id
          WHERE l.account_id = $1 AND e.status = 'POSTED'
      `, [accountId]);
      const newBalance = sumRes.rows[0].total ? BigInt(sumRes.rows[0].total) : 0n;

      // 3. Update if different
      if (oldBalance !== newBalance) {
        await client.query(`UPDATE accounts SET ledger_balance = $1 WHERE id = $2`, [newBalance, accountId]);
      }

      return {
        old: oldBalance.toString(),
        new: newBalance.toString(),
        diff: (newBalance - oldBalance).toString()
      };
    });
  }

  async captureSnapshot(accountId: AccountId): Promise<string> {
    return runAtomic(async (client: PoolClient) => {
      const res = await client.query(`SELECT ledger_balance FROM accounts WHERE id = $1`, [accountId]);
      if (res.rowCount === 0) throw new Error('Account not found');

      const balance = res.rows[0].ledger_balance;
      const snapRes = await client.query(
        `INSERT INTO balance_snapshots (account_id, balance) VALUES ($1, $2) RETURNING id`,
        [accountId, balance]
      );
      return snapRes.rows[0].id;
    });
  }

  async createAccount(
    id: string,
    code: string,
    type: string,
    allowOverdraft = false,
    parentId?: string,
    isHeader = false,
    status = 'ACTIVE',
    minBalance: bigint = 0n
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO accounts (id, code, type, allow_overdraft, parent_id, is_header, status, min_balance) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET 
         status = $7,
         type = $3,
         allow_overdraft = $4,
         min_balance = $8`,
      [id, code, type, allowOverdraft, parentId || null, isHeader, status, minBalance]
    );
  }

  async updateAccount(
    id: string,
    updates: {
      status?: string;
      allowOverdraft?: boolean;
      minBalance?: bigint;
      type?: string;
    }
  ): Promise<void> {
    // Dynamically build update query
    const fields: string[] = [];
    const values: any[] = [id];
    let idx = 2;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.allowOverdraft !== undefined) {
      fields.push(`allow_overdraft = $${idx++}`);
      values.push(updates.allowOverdraft);
    }
    if (updates.minBalance !== undefined) {
      fields.push(`min_balance = $${idx++}`);
      values.push(updates.minBalance);
    }
    if (updates.type !== undefined) {
      fields.push(`type = $${idx++}`);
      values.push(updates.type);
    }

    if (fields.length === 0) return;

    await this.pool.query(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = $1`,
      values
    );
  }

  // --- Reporting Helpers needed for report_excel.ts ---

  async getAllAccounts(): Promise<Account[]> {
    const res = await this.pool.query('SELECT * FROM accounts ORDER BY code');
    return res.rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      type: r.type,
      ledgerBalance: BigInt(r.ledger_balance),
      pendingBalance: BigInt(r.pending_balance),
      allowOverdraft: r.allow_overdraft,
      status: r.status,
      isHeader: r.is_header,
      createdAt: r.created_at,
      minBalance: BigInt(r.min_balance)
    }));
  }

  async getAccount(id: string): Promise<Account> {
    const res = await this.pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
    if (res.rowCount === 0) throw new Error('Account not found');
    const r = res.rows[0];
    return {
      id: r.id,
      code: r.code,
      type: r.type,
      ledgerBalance: BigInt(r.ledger_balance),
      pendingBalance: BigInt(r.pending_balance),
      allowOverdraft: r.allow_overdraft,
      status: r.status,
      isHeader: r.is_header,
      createdAt: r.created_at,
      minBalance: BigInt(r.min_balance)
    };
  }

  async getAccounts(ids: string[]): Promise<Account[]> {
    if (ids.length === 0) return [];
    const res = await this.pool.query('SELECT * FROM accounts WHERE id = ANY($1::text[])', [ids]);
    return res.rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      type: r.type,
      ledgerBalance: BigInt(r.ledger_balance),
      pendingBalance: BigInt(r.pending_balance),
      allowOverdraft: r.allow_overdraft,
      status: r.status,
      isHeader: r.is_header,
      createdAt: r.created_at,
      minBalance: BigInt(r.min_balance)
    }));
  }

  async searchAccounts(pattern: string): Promise<Account[]> {
    // pattern should be a SQL LIKE pattern (e.g. 'LIABILITY:MERCHANT:%:PAYIN')
    const res = await this.pool.query('SELECT * FROM accounts WHERE id LIKE $1', [pattern]);
    return res.rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      type: r.type,
      ledgerBalance: BigInt(r.ledger_balance),
      pendingBalance: BigInt(r.pending_balance),
      allowOverdraft: r.allow_overdraft,
      status: r.status,
      isHeader: r.is_header,
      createdAt: r.created_at,
      minBalance: BigInt(r.min_balance)
    }));
  }

  async getAccountTypes(accountIds: string[]): Promise<Map<string, AccountType>> {
    const ids = Array.from(new Set(accountIds));
    if (ids.length === 0) return new Map();
    const res = await this.pool.query(`SELECT id, type FROM accounts WHERE id = ANY($1::text[])`, [ids]);
    const map = new Map<string, AccountType>();
    for (const row of res.rows) {
      map.set(row.id, row.type);
    }
    return map;
  }

  async getTrialBalance(): Promise<any> {
    // This is used by report_excel.ts
    // Return simple array or object for now
    const accounts = await this.getAllAccounts();
    const totalBalance = accounts.reduce((sum, a) => sum + (BigInt(a.ledgerBalance)), 0n);
    return {
      accounts,
      totalBalance,
      isBalanced: totalBalance === 0n
    };
  }
}
