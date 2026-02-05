import { initConnection, close, query, dbProperties, LedgerPoolConfig } from '../infra/postgres';
import { PostingEngine } from '../engine/PostingEngine';
import { LedgerWriter } from '../engine/LedgerWriter';
import { computeEntryHash } from '../verification/HashUtils';
import { runAtomic } from '../infra/atomic';
import { AuditService } from '../services/AuditService';
import { logger as pinoLogger } from '../infra/logger';

export interface JobLogger {
  log?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

export interface JobOptions {
  init?: LedgerPoolConfig;
  autoClose?: boolean;
  logger?: JobLogger;
}

export interface SnapshotJobOptions extends JobOptions {
  batchSize?: number;
}

export interface SealLedgerJobOptions extends JobOptions {
  batchSize?: number;
}

export interface VerifyIntegrityJobOptions extends JobOptions {
  stopOnPending?: boolean;
}

export interface IntegrityChecksJobOptions extends JobOptions { }

export interface EodRebuildJobOptions extends JobOptions {
  eodAt?: Date;
  snapshotAll?: boolean;
}

const defaultLogger: JobLogger = {
  log: (msg) => pinoLogger.info(msg),
  info: (msg) => pinoLogger.info(msg),
  warn: (msg) => pinoLogger.warn(msg),
  error: (msg) => pinoLogger.error(msg),
};

async function withConnection<T>(options: JobOptions | undefined, task: () => Promise<T>): Promise<T> {
  const logger = options?.logger || defaultLogger;
  if (options?.init) {
    initConnection(options.init);
  }

  try {
    return await task();
  } catch (e) {
    logger.error?.(e);
    throw e;
  } finally {
    if (options?.autoClose) {
      await close();
    }
  }
}

/**
 * Automates creating balance snapshots.
 * Run via cron (nightly or hourly).
 */
export async function runSnapshotJob(options: SnapshotJobOptions = {}): Promise<{ processed: number }> {
  const logger = options.logger || pinoLogger;
  return withConnection(options, async () => {
    logger.info?.('📸 Starting Auto-Snapshot Job...');
    const engine = new PostingEngine(dbProperties.pool, new LedgerWriter());

    const res = await query(`SELECT id FROM accounts WHERE status = 'ACTIVE'`);
    const accounts = res.rows;

    logger.info?.(`Checking ${accounts.length} accounts...`);
    let count = 0;

    for (const acc of accounts) {
      await engine.captureSnapshot(acc.id);
      count++;
      if (options.batchSize && count % options.batchSize === 0) {
        logger.info?.(`Processed ${count}...`);
      }
    }

    logger.info?.(`✅ Snapshot complete for ${count} accounts.`);
    await AuditService.log('SNAPSHOT_JOB', 'ALL', 'system', { processed: count });
    return { processed: count };
  });
}

/**
 * Async Sealer (Notary). Connects the hash chain for high-throughput writes.
 */
export async function runSealLedgerJob(options: SealLedgerJobOptions = {}): Promise<void> {
  const logger = options.logger || pinoLogger;
  const batchSize = options.batchSize || 100;
  return withConnection(options, async () => {
    logger.info?.('⛓️  Starting Ledger Sealer...');

    const tipRes = await query(`
        SELECT hash, sequence 
        FROM journal_entries 
        WHERE hash IS NOT NULL 
        ORDER BY sequence DESC 
        LIMIT 1
      `);

    let previousHash = tipRes.rows[0]?.hash || null;
    let lastSequence = tipRes.rows[0]?.sequence || 0;

    logger.info?.(
      `Tip: Seq ${lastSequence} | Hash ${previousHash ? previousHash.substring(0, 8) : 'GENESIS'}`,
    );

    while (true) {
      const batchRes = await query(
        `
          SELECT id, description, posted_at, sequence 
          FROM journal_entries 
          WHERE hash IS NULL 
          ORDER BY sequence ASC 
          LIMIT $1
        `,
        [batchSize],
      );

      if (batchRes.rowCount === 0) {
        logger.info?.('✅ Ledger Up to Date.');
        break;
      }

      logger.info?.(`Processing batch of ${batchRes.rowCount}...`);

      for (const entry of batchRes.rows) {
        const linesRes = await query(`SELECT account_id, amount FROM journal_lines WHERE entry_id = $1`, [
          entry.id,
        ]);
        const lines = linesRes.rows.map((l) => ({ accountId: l.account_id, amount: BigInt(l.amount) }));

        const newHash: string = computeEntryHash(
          previousHash,
          entry.id,
          entry.posted_at ? new Date(entry.posted_at) : null,
          entry.description,
          lines,
        );

        await query(
          `UPDATE journal_entries SET hash = $1, previous_hash = $2 WHERE id = $3`,
          [newHash, previousHash, entry.id],
        );

        previousHash = newHash;
      }
    }
    await AuditService.log('SEAL_LEDGER_JOB', 'ALL', 'system', { batchSize });
  });
}

/**
 * Verifies the Cryptographic Integrity of the Ledger.
 */
export async function runVerifyIntegrityJob(options: VerifyIntegrityJobOptions = {}): Promise<{
  checked: number;
  errors: number;
  ok: boolean;
}> {
  const logger = options.logger || pinoLogger;
  const stopOnPending = options.stopOnPending ?? true;
  return withConnection(options, async () => {
    logger.info?.('🕵️  Starting Integrity Verification...');

    const res = await query(`
        SELECT 
            e.id, 
            e.description, 
            e.posted_at, 
            e.hash, 
            e.previous_hash, 
            e.sequence
        FROM journal_entries e
        ORDER BY e.sequence ASC
      `);

    logger.info?.(`Checking ${res.rows.length} entries...`);

    let previousHash: string | null = null;
    let errors = 0;
    let checked = 0;

    for (const entry of res.rows) {
      if (entry.hash === null) {
        logger.info?.(`⚠️  Seq ${entry.sequence}: PENDING SEAL`);
        if (stopOnPending) break;
      }

      const linesRes = await query(`SELECT account_id, amount FROM journal_lines WHERE entry_id = $1`, [
        entry.id,
      ]);
      const lines = linesRes.rows.map((l) => ({ accountId: l.account_id, amount: BigInt(l.amount) }));

      const computed = computeEntryHash(
        previousHash,
        entry.id,
        entry.posted_at ? new Date(entry.posted_at) : null,
        entry.description,
        lines,
      );

      if (computed !== entry.hash) {
        logger.error?.(`🚨 TAMPERING DETECTED at Seq ${entry.sequence} (ID: ${entry.id})`);
        logger.error?.(`   Stored:   ${entry.hash}`);
        logger.error?.(`   Computed: ${computed}`);
        errors++;
      }

      if (entry.previous_hash !== previousHash) {
        logger.error?.(`🚨 BROKEN LINK at Seq ${entry.sequence}. PrevHash mismatch.`);
        errors++;
      }

      previousHash = entry.hash;
      checked++;
    }

    if (errors === 0) {
      logger.info?.('✅ Integrity Verified. Ledger is Immutable.');
    } else {
      logger.error?.(`❌ Verification FAILED with ${errors} errors.`);
    }

    await AuditService.log('VERIFY_INTEGRITY_JOB', 'ALL', 'system', { checked, errors });
    return { checked, errors, ok: errors === 0 };
  });
}

/**
 * Structural integrity checks (double-entry, balance integrity, line traceability, entry completeness).
 */
export async function runIntegrityChecksJob(
  options: IntegrityChecksJobOptions = {},
): Promise<{ ok: boolean; checks: Array<{ name: string; count: number }> }> {
  const logger = options.logger || pinoLogger;
  return withConnection(options, async () => {
    logger.info?.('🔎 Running Integrity Checks...');

    const checks: Array<{ name: string; count: number }> = [];

    const q1 = await query(`
      SELECT entry_id, SUM(amount) as imbalance
      FROM journal_lines l
      JOIN journal_entries e ON l.entry_id = e.id
      WHERE e.status = 'POSTED'
      GROUP BY entry_id
      HAVING SUM(amount) <> 0;
    `);
    checks.push({ name: 'double_entry_imbalance', count: q1.rowCount || 0 });

    const q2 = await query(`
      WITH recalculated AS (
        SELECT l.account_id, SUM(l.amount) as calc_balance
        FROM journal_lines l
        JOIN journal_entries e ON l.entry_id = e.id
        WHERE e.status = 'POSTED'
        GROUP BY l.account_id
      )
      SELECT a.id
      FROM accounts a
      LEFT JOIN recalculated r ON a.id = r.account_id
      WHERE a.ledger_balance <> COALESCE(r.calc_balance, 0);
    `);
    checks.push({ name: 'account_balance_mismatch', count: q2.rowCount || 0 });

    const q3 = await query(`
      WITH ordered_lines AS (
        SELECT 
          l.account_id,
          l.amount,
          l.balance_after,
          LAG(l.balance_after, 1, 0) OVER (PARTITION BY l.account_id ORDER BY l.created_at, l.id) as prev_balance
        FROM journal_lines l
        JOIN journal_entries e ON l.entry_id = e.id
        WHERE e.status = 'POSTED'
      )
      SELECT *
      FROM ordered_lines
      WHERE prev_balance + amount <> balance_after;
    `);
    checks.push({ name: 'line_traceability_break', count: q3.rowCount || 0 });

    const q4 = await query(`
      SELECT e.id
      FROM journal_entries e
      LEFT JOIN journal_lines l ON l.entry_id = e.id
      GROUP BY e.id
      HAVING COUNT(l.id) = 0;
    `);
    checks.push({ name: 'entries_without_lines', count: q4.rowCount || 0 });

    const ok = checks.every((c) => c.count === 0);
    logger.info?.(ok ? '✅ Integrity Checks Passed.' : '❌ Integrity Checks Failed.');
    await AuditService.log('INTEGRITY_CHECKS_JOB', 'ALL', 'system', { ok, checks });
    return { ok, checks };
  });
}

/**
 * Database maintenance tuning for high-throughput usage.
 */
export async function runOptimizeDbJob(options: JobOptions = {}): Promise<void> {
  const logger = options.logger || pinoLogger;
  return withConnection(options, async () => {
    logger.info?.('🔧 Optimization 1: Tuning Accounts Table (HOT Updates)...');
    await query(`ALTER TABLE accounts SET (fillfactor = 70);`);
    await query(`VACUUM FULL accounts;`);

    logger.info?.('🔧 Optimization 2: Tuning Journal Entries (Append Performance)...');
    await query(`ALTER TABLE journal_lines SET (autovacuum_enabled = on);`);

    logger.info?.('🔍 Optimization 3: Analyzing Statistics...');
    await query(`ANALYZE;`);

    logger.info?.('✅ Optimization Complete. DB is tuned for High Throughput.');
    await AuditService.log('OPTIMIZE_DB_JOB', 'ALL', 'system', {});
  });
}

/**
 * DANGER: Clears all ledger data. Use only in dev/test.
 */
export async function runResetDbJob(options: JobOptions = {}): Promise<void> {
  const logger = options.logger || pinoLogger;
  return withConnection(options, async () => {
    logger.info?.('🗑️  Clearing Database...');
    await query('TRUNCATE TABLE journal_lines CASCADE');
    await query('TRUNCATE TABLE journal_entries CASCADE');
    await query('TRUNCATE TABLE balance_snapshots CASCADE');
    await query('TRUNCATE TABLE audit_logs CASCADE');
    await query('DELETE FROM accounts CASCADE');
    logger.info?.('✅ Database Cleared.');
    await AuditService.log('RESET_DB_JOB', 'ALL', 'system', {});
  });
}

/**
 * End-of-day rebuild: recompute ledger balances from posted lines.
 * If differences are found, update accounts and insert balance snapshots at EOD.
 */
export async function runEodRebuildJob(
  options: EodRebuildJobOptions = {},
): Promise<{ updated: number; snapshots: number; eodAt: Date }> {
  const logger = options.logger || pinoLogger;
  const now = new Date();
  const eodAt = options.eodAt
    ? new Date(options.eodAt)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  return withConnection(options, async () => {
    logger.info?.('🧮 Starting EOD Ledger Rebuild...');

    return runAtomic(async (client) => {
      const updatedRes = await client.query(`
        WITH recalculated AS (
          SELECT a.id, COALESCE(r.calc_balance, 0) AS calc_balance
          FROM accounts a
          LEFT JOIN (
            SELECT l.account_id, SUM(l.amount) AS calc_balance
            FROM journal_lines l
            JOIN journal_entries e ON l.entry_id = e.id
            WHERE e.status = 'POSTED'
            GROUP BY l.account_id
          ) r ON a.id = r.account_id
        ),
        updated AS (
          UPDATE accounts a
          SET ledger_balance = r.calc_balance
          FROM recalculated r
          WHERE a.id = r.id AND a.ledger_balance <> r.calc_balance
          RETURNING a.id, r.calc_balance
        )
        SELECT * FROM updated
      `);

      const updated = updatedRes.rowCount || 0;

      let snapshots = 0;
      if (options.snapshotAll) {
        const snapRes = await client.query(
          `
            WITH recalculated AS (
              SELECT a.id, COALESCE(r.calc_balance, 0) AS calc_balance
              FROM accounts a
              LEFT JOIN (
                SELECT l.account_id, SUM(l.amount) AS calc_balance
                FROM journal_lines l
                JOIN journal_entries e ON l.entry_id = e.id
                WHERE e.status = 'POSTED'
                GROUP BY l.account_id
              ) r ON a.id = r.account_id
            )
            INSERT INTO balance_snapshots (account_id, balance, created_at)
            SELECT id, calc_balance, $1
            FROM recalculated
            ON CONFLICT (account_id, created_at) DO NOTHING
          `,
          [eodAt],
        );
        snapshots = snapRes.rowCount || 0;
      } else if (updatedRes.rowCount && updatedRes.rowCount > 0) {
        const ids = updatedRes.rows.map((r) => r.id);
        const balances = updatedRes.rows.map((r) => r.calc_balance);
        const values = ids
          .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::bigint, $${ids.length * 2 + 1})`)
          .join(',');
        const params = [...ids, ...balances, eodAt];
        const snapRes = await client.query(
          `INSERT INTO balance_snapshots (account_id, balance, created_at) VALUES ${values}
           ON CONFLICT (account_id, created_at) DO NOTHING`,
          params,
        );
        snapshots = snapRes.rowCount || 0;
      }

      logger.info?.(`✅ EOD Rebuild complete. Updated: ${updated}, Snapshots: ${snapshots}`);
      await AuditService.log('EOD_REBUILD_JOB', 'ALL', 'system', { updated, snapshots, eodAt });
      return { updated, snapshots, eodAt };
    });
  });
}
