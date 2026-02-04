/**
 * Reconciliation Job
 *
 * Verifies ledger integrity by comparing:
 * - Stored account balances vs. calculated balances from entries
 * - Total debits == total credits (system-wide)
 * - Individual account constraint violations
 */

import { getPostgres } from "@/infra/postgres/connection";
import { LedgerAccount, LedgerEntry } from "@/services/ledger-pg/pg-ledger.service";
import { paisaToRupee } from "@/services/ledger-pg/pg-account-manager.service";
import { logger } from "@/infra/logger-instance";

interface ReconciliationResult {
  accountId: string;
  ownerId: string;
  ownerType: string;
  accountType: string;
  storedBalance: bigint;
  calculatedBalance: bigint;
  discrepancy: bigint;
  status: "OK" | "DISCREPANCY";
}

interface SystemReconciliation {
  totalDebits: bigint;
  totalCredits: bigint;
  isBalanced: boolean;
  discrepancy: bigint;
}

export async function runReconciliationJob(): Promise<void> {
  const sql = getPostgres();

  logger.info("Starting reconciliation job");

  const startTime = Date.now();
  const results: ReconciliationResult[] = [];
  let discrepancyCount = 0;

  try {
    // Get all accounts
    const accounts = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE is_active = TRUE
      ORDER BY owner_type, owner_id, account_type
    `;

    // Reconcile each account
    for (const account of accounts) {
      // Calculate balance from entries
      const [calculated] = await sql<{ total_debits: bigint; total_credits: bigint }[]>`
        SELECT
          COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as total_debits,
          COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as total_credits
        FROM ledger_entries
        WHERE account_id = ${account.id}
      `;

      const calculatedDebitsPosted = calculated?.total_debits || 0n;
      const calculatedCreditsPosted = calculated?.total_credits || 0n;

      // Compare with stored balance
      const storedDebitsPosted = account.debits_posted;
      const storedCreditsPosted = account.credits_posted;

      const storedNetBalance = storedCreditsPosted - storedDebitsPosted;
      const calculatedNetBalance = calculatedCreditsPosted - calculatedDebitsPosted;

      const discrepancy = storedNetBalance - calculatedNetBalance;
      const hasDiscrepancy = discrepancy !== 0n;

      if (hasDiscrepancy) {
        discrepancyCount++;
        logger.warn(
          {
            accountId: account.id,
            ownerId: account.owner_id,
            accountType: account.account_type,
            storedBalance: paisaToRupee(storedNetBalance),
            calculatedBalance: paisaToRupee(calculatedNetBalance),
            discrepancy: paisaToRupee(discrepancy),
          },
          "Balance discrepancy detected"
        );
      }

      results.push({
        accountId: account.id,
        ownerId: account.owner_id,
        ownerType: account.owner_type,
        accountType: account.account_type,
        storedBalance: storedNetBalance,
        calculatedBalance: calculatedNetBalance,
        discrepancy,
        status: hasDiscrepancy ? "DISCREPANCY" : "OK",
      });
    }

    // System-wide double-entry check
    const [systemTotals] = await sql<{ total_debits: bigint; total_credits: bigint }[]>`
      SELECT
        COALESCE(SUM(debits_posted), 0) as total_debits,
        COALESCE(SUM(credits_posted), 0) as total_credits
      FROM ledger_accounts
    `;

    const systemDebits = systemTotals?.total_debits || 0n;
    const systemCredits = systemTotals?.total_credits || 0n;
    const systemBalanced = systemDebits === systemCredits;
    const systemDiscrepancy = systemDebits - systemCredits;

    // Log reconciliation record
    await sql`
      INSERT INTO reconciliation_log (
        status,
        calculated_balance,
        stored_balance,
        discrepancy,
        details,
        completed_at
      ) VALUES (
        ${discrepancyCount === 0 && systemBalanced ? "SUCCESS" : "DISCREPANCY"},
        ${systemCredits},
        ${systemDebits},
        ${systemDiscrepancy},
        ${JSON.stringify({
          accountsChecked: accounts.length,
          discrepanciesFound: discrepancyCount,
          systemBalanced,
          systemDiscrepancy: systemDiscrepancy.toString(),
          durationMs: Date.now() - startTime,
        })},
        NOW()
      )
    `;

    if (!systemBalanced) {
      logger.error(
        {
          totalDebits: paisaToRupee(systemDebits),
          totalCredits: paisaToRupee(systemCredits),
          discrepancy: paisaToRupee(systemDiscrepancy),
        },
        "System-wide double-entry imbalance detected!"
      );
    }

    logger.info(
      {
        accountsChecked: accounts.length,
        discrepanciesFound: discrepancyCount,
        systemBalanced,
        durationMs: Date.now() - startTime,
      },
      "Reconciliation job completed"
    );
  } catch (error) {
    logger.error({ error }, "Reconciliation job failed");

    // Log failed reconciliation
    await sql`
      INSERT INTO reconciliation_log (
        status,
        details,
        completed_at
      ) VALUES (
        'ERROR',
        ${JSON.stringify({ error: (error as Error).message })},
        NOW()
      )
    `;

    throw error;
  }
}

export async function runBalanceSnapshotJob(): Promise<void> {
  const sql = getPostgres();

  logger.info("Starting balance snapshot job");

  const snapshotDate = new Date();
  snapshotDate.setHours(0, 0, 0, 0);

  try {
    // Get all accounts
    const accounts = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      ORDER BY owner_type, owner_id, account_type
    `;

    // Check if snapshot already exists for today
    const [existing] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int as count FROM balance_snapshots
      WHERE snapshot_date = ${snapshotDate}
    `;

    if (existing && existing.count > 0) {
      logger.info(
        { snapshotDate, existingCount: existing.count },
        "Snapshot already exists for today, skipping"
      );
      return;
    }

    // Create snapshots
    for (const account of accounts) {
      const netBalance = account.credits_posted - account.debits_posted;

      await sql`
        INSERT INTO balance_snapshots (
          account_id,
          debits_pending,
          debits_posted,
          credits_pending,
          credits_posted,
          net_balance,
          snapshot_type,
          snapshot_date
        ) VALUES (
          ${account.id},
          ${account.debits_pending},
          ${account.debits_posted},
          ${account.credits_pending},
          ${account.credits_posted},
          ${netBalance},
          'DAILY',
          ${snapshotDate}
        )
      `;
    }

    logger.info(
      { snapshotDate, accountCount: accounts.length },
      "Balance snapshot job completed"
    );
  } catch (error) {
    logger.error({ error }, "Balance snapshot job failed");
    throw error;
  }
}

export async function runConstraintValidationJob(): Promise<void> {
  const sql = getPostgres();

  logger.info("Starting constraint validation job");

  try {
    // Find accounts with negative balance that shouldn't have it
    const violations = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE allow_negative_balance = FALSE
      AND (credits_posted - debits_posted) < 0
    `;

    if (violations.length > 0) {
      logger.error(
        {
          violationCount: violations.length,
          accounts: violations.map((a) => ({
            id: a.id,
            ownerId: a.owner_id,
            accountType: a.account_type,
            balance: paisaToRupee(a.credits_posted - a.debits_posted),
          })),
        },
        "Balance constraint violations detected!"
      );

      // Log violations
      for (const account of violations) {
        await sql`
          INSERT INTO reconciliation_log (
            account_id,
            status,
            details,
            completed_at
          ) VALUES (
            ${account.id},
            'DISCREPANCY',
            ${JSON.stringify({
              type: "NEGATIVE_BALANCE_VIOLATION",
              ownerId: account.owner_id,
              accountType: account.account_type,
              balance: (account.credits_posted - account.debits_posted).toString(),
            })},
            NOW()
          )
        `;
      }
    }

    // Check for pending amounts exceeding posted
    const pendingViolations = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE allow_negative_balance = FALSE
      AND debits_pending > (credits_posted - debits_posted)
    `;

    if (pendingViolations.length > 0) {
      logger.warn(
        {
          violationCount: pendingViolations.length,
          accounts: pendingViolations.map((a) => ({
            id: a.id,
            ownerId: a.owner_id,
            accountType: a.account_type,
            pendingDebits: paisaToRupee(a.debits_pending),
            availableBalance: paisaToRupee(a.credits_posted - a.debits_posted),
          })),
        },
        "Pending amount exceeds available balance"
      );
    }

    logger.info(
      {
        balanceViolations: violations.length,
        pendingViolations: pendingViolations.length,
      },
      "Constraint validation job completed"
    );
  } catch (error) {
    logger.error({ error }, "Constraint validation job failed");
    throw error;
  }
}
