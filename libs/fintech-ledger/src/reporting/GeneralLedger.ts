import { query } from '../infra/postgres';
import { AccountId, AccountType } from '../api/types';
import { normalizeBalance, normalBalanceSide } from '../utils/Accounting';

export interface GeneralLedgerSummary {
  accountId: string;
  openingBalance: bigint;
  debitTotal: bigint;
  creditTotal: bigint;
  closingBalance: bigint;
  rawOpeningBalance: bigint;
  rawDebitTotal: bigint;
  rawCreditTotal: bigint;
  rawClosingBalance: bigint;
  normalBalanceSide: 'DEBIT' | 'CREDIT';
}

export class GeneralLedger {
  /**
   * Calculates the General Ledger for a specific period.
   */
  async getReport(
    accountId: AccountId,
    fromDate: Date,
    toDate: Date,
  ): Promise<GeneralLedgerSummary> {
    // 1. Calculate Opening Balance (Sum of lines BEFORE fromDate)
    const openingRes = await query({
      name: 'report_gl_opening',
      text: `
      SELECT SUM(l.amount) as balance
      FROM journal_lines l
      JOIN journal_entries e ON l.entry_id = e.id
      WHERE l.account_id = $1
      AND e.posted_at < $2
    `,
      values: [accountId, fromDate],
    });

    const openingBalance = BigInt(openingRes.rows[0].balance || 0);

    // 2. Calculate Period Activity
    const activityRes = await query({
      name: 'report_gl_activity',
      text: `
      SELECT 
        SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) as debit_total,
        SUM(CASE WHEN l.amount < 0 THEN l.amount ELSE 0 END) as credit_total
      FROM journal_lines l
      JOIN journal_entries e ON l.entry_id = e.id
      WHERE l.account_id = $1
      AND e.posted_at >= $2 AND e.posted_at <= $3
    `,
      values: [accountId, fromDate, toDate],
    });

    const debitTotal = BigInt(activityRes.rows[0].debit_total || 0);
    const creditTotal = BigInt(activityRes.rows[0].credit_total || 0);

    // 3. Closing Balance
    const closingBalance = openingBalance + debitTotal + creditTotal;

    const typeRes = await query({
      name: 'report_account_type',
      text: `SELECT type FROM accounts WHERE id = $1`,
      values: [accountId],
    });
    const type = typeRes.rows[0]?.type as AccountType;

    return {
      accountId,
      openingBalance: normalizeBalance(type, openingBalance),
      debitTotal: normalizeBalance(type, debitTotal),
      creditTotal: normalizeBalance(type, creditTotal),
      closingBalance: normalizeBalance(type, closingBalance),
      rawOpeningBalance: openingBalance,
      rawDebitTotal: debitTotal,
      rawCreditTotal: creditTotal,
      rawClosingBalance: closingBalance,
      normalBalanceSide: normalBalanceSide(type),
    };
  }
}
