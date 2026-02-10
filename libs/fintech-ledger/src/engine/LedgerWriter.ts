import { PoolClient } from 'pg';
import { LedgerCommand, LedgerEntryId } from '../api/types';
import { DoubleEntryError, AccountNotFoundError, InsufficientFundsError } from '../api/errors';
import { getLockOrder } from './LockOrdering';
import { randomUUID } from 'crypto';
import { Money } from '../utils/Money';

export class LedgerWriter {
  /**
   * Commits a transaction to the ledger using Bulk SQL.
   * O(1) Query Count regardless of Line Count.
   */
  async commitEntry(
    client: PoolClient,
    command: LedgerCommand,
    posted: boolean,
  ): Promise<LedgerEntryId> {
    // 0. Idempotency Check
    if (command.idempotencyKey) {
      const existingInfo = await client.query({
        name: 'ledger_idempotency_lookup',
        text: `SELECT id FROM journal_entries WHERE idempotency_key = $1`,
        values: [command.idempotencyKey],
      });
      if (existingInfo.rowCount && existingInfo.rowCount > 0) {
        return existingInfo.rows[0].id; // Return existing ID
      }
    }

    // 1. Lock Accounts (Batch)
    const normalizedLines = command.lines.map((line) => ({
      ...line,
      amount: Money.toPaisa(line.amount),
    }));

    const accountIds = [...new Set(normalizedLines.map((l) => l.accountId))]; // Unique
    const sortedIds = getLockOrder(accountIds);

    // Fetch accounts with FOR UPDATE
    const accountsRes = await client.query({
      name: 'ledger_accounts_lock',
      text: `SELECT id, ledger_balance, pending_balance, allow_overdraft, type, status, min_balance 
             FROM accounts 
             WHERE id = ANY($1::text[]) 
             ORDER BY id FOR UPDATE`,
      values: [sortedIds],
    });

    if (accountsRes.rowCount !== accountIds.length) {
      const found = new Set(accountsRes.rows.map((r: any) => r.id));
      const missing = accountIds.find((id) => !found.has(id));
      throw new AccountNotFoundError(missing || 'Unknown');
    }

    const accountMap = new Map();
    const configMap = new Map();

    for (const row of accountsRes.rows) {
      accountMap.set(row.id, {
        ledger: BigInt(row.ledger_balance),
        pending: BigInt(row.pending_balance),
      });
      configMap.set(row.id, {
        allowOverdraft: row.allow_overdraft,
        type: row.type,
        status: row.status,
        minBalance: BigInt(row.min_balance || 0),
      });
    }

    // 2. Calculate New States & Validate
    let sum = 0n;
    const updates = new Map<string, { newLedger: bigint; newPending: bigint }>();

    for (const line of normalizedLines) {
      const amount = line.amount;
      sum += amount;

      const current = accountMap.get(line.accountId)!;
      const config = configMap.get(line.accountId)!;

      // Status Checks
      if (config.status === 'FROZEN') {
        throw new Error(`Account ${line.accountId} is FROZEN. Transaction blocked.`);
      }

      if (config.status === 'LOCKED_OUTFLOW') {
        if (config.type === 'ASSET' && amount < 0n)
          throw new Error(`Account ${line.accountId} is LOCKED_OUTFLOW.`);
        if (config.type === 'LIABILITY' && amount > 0n)
          throw new Error(`Account ${line.accountId} is LOCKED_OUTFLOW.`);
      }

      if (config.status === 'LOCKED_INFLOW') {
        if (config.type === 'ASSET' && amount > 0n)
          throw new Error(`Account ${line.accountId} is LOCKED_INFLOW.`);
        if (config.type === 'LIABILITY' && amount < 0n)
          throw new Error(`Account ${line.accountId} is LOCKED_INFLOW.`);
      }

      // Calculate Future State
      // Initialize with current DB state if not tracked in 'updates' yet
      if (!updates.has(line.accountId)) {
        updates.set(line.accountId, { newLedger: current.ledger, newPending: current.pending });
      }
      const state = updates.get(line.accountId)!;

      if (posted) {
        state.newLedger += amount;
      } else {
        state.newPending += amount;
      }

      // Overdraft / Min-Balance Checks
      if (!config.allowOverdraft) {
        if (config.type === 'ASSET') {
          const minBalance = config.minBalance ?? 0n;
          const effective = posted ? state.newLedger : state.newLedger + state.newPending;
          if (effective < minBalance) {
            throw new InsufficientFundsError(line.accountId, effective, minBalance);
          }
        }

        if (config.type === 'LIABILITY') {
          // Liability should not become positive (no overdraft to the "asset" side)
          const effective = posted ? state.newLedger : state.newLedger + state.newPending;
          if (effective > 0n) {
            throw new InsufficientFundsError(line.accountId, effective, 0n);
          }
        }
      }
    }

    if (sum !== 0n) throw new DoubleEntryError(sum);

    // 3. Create Entry (Header) - ASYNC HASH (High Performance)
    const entryId = randomUUID();

    // NOTE: Hashing is offloaded to 'seal_ledger.ts' to prevent latency spikes.
    // Insert with NULL hash.

    await client.query({
      name: 'ledger_insert_entry',
      text: `INSERT INTO journal_entries 
             (id, description, posted_at, status, idempotency_key, external_ref, correlation_id, value_date, metadata, hash, previous_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL)
            `,
      values: [
        entryId,
        command.description,
        posted ? new Date() : null,
        posted ? 'POSTED' : 'PENDING',
        command.idempotencyKey || null,
        command.externalRef || null,
        command.correlationId || null,
        command.valueDate || null,
        command.metadata || null,
      ],
    });

    // 4. Bulk Update Accounts
    // 4. Bulk Update Accounts
    // Construct VALUES list: ('id', ledger, pending), ('id', ledger, pending)
    if (updates.size > 0) {
      const updateValues: string[] = [];
      const updateParams: (string | bigint)[] = [];
      let pIdx = 1;

      for (const [accId, state] of updates.entries()) {
        updateValues.push(`($${pIdx++}, $${pIdx++}::bigint, $${pIdx++}::bigint)`);
        updateParams.push(accId, state.newLedger, state.newPending);
        // Hint: Casting ::bigint is important for numeric types in VALUES clause
      }

      await client.query(
        `UPDATE accounts AS a
         SET ledger_balance = v.ledger,
             pending_balance = v.pending
         FROM (VALUES ${updateValues.join(',')}) AS v(id, ledger, pending)
         WHERE a.id = v.id`,
        updateParams,
      );
    }

    // 5. Bulk Insert Lines
    if (normalizedLines.length > 0) {
      // Compute per-line balance_after (important for traceability checks)
      const runningLedger = new Map<string, bigint>();
      for (const [accId, state] of accountMap.entries()) {
        runningLedger.set(accId, state.ledger);
      }
      const lineBalances: bigint[] = [];
      for (const line of normalizedLines) {
        const current = runningLedger.get(line.accountId) || 0n;
        if (posted) {
          const next = current + line.amount;
          runningLedger.set(line.accountId, next);
          lineBalances.push(next);
        } else {
          lineBalances.push(current);
        }
      }

      const lineValues: string[] = [];
      const lineParams: (string | bigint)[] = [];
      let lIdx = 1;

      for (let i = 0; i < normalizedLines.length; i++) {
        const line = normalizedLines[i];
        const balanceAfter = lineBalances[i];
        lineValues.push(
          `($${lIdx++}, $${lIdx++}, $${lIdx++}, $${lIdx++}::bigint, $${lIdx++}::bigint)`,
        );
        lineParams.push(randomUUID(), entryId, line.accountId, line.amount, balanceAfter);
      }

      await client.query(
        `INSERT INTO journal_lines (id, entry_id, account_id, amount, balance_after)
         VALUES ${lineValues.join(',')}`,
        lineParams,
      );
    }

    return entryId;
  }
}
