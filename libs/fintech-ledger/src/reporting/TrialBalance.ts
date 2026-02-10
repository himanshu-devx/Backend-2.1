import { query } from '../infra/postgres';
import { AccountType } from '../api/types';
import { normalizeBalance, normalBalanceSide } from '../utils/Accounting';
import { Money } from '../utils/Money';

export interface TrialBalanceLine {
  accountId: string;
  code: string;
  debitTotal: string;
  creditTotal: string;
  netBalance: string;
  rawDebitTotal: string;
  rawCreditTotal: string;
  rawNetBalance: string;
  normalBalanceSide: 'DEBIT' | 'CREDIT';
}

export class TrialBalance {
  async getReport(): Promise<TrialBalanceLine[]> {
    // We aggregate from journal_lines to prove correctness against accounts table
    const sql = `
      SELECT 
        l.account_id,
        a.code,
        a.type,
        SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) as debit_total,
        SUM(CASE WHEN l.amount < 0 THEN l.amount ELSE 0 END) as credit_total,
        SUM(l.amount) as net_balance
      FROM journal_lines l
      JOIN accounts a ON l.account_id = a.id
      JOIN journal_entries e ON l.entry_id = e.id
      WHERE e.posted_at IS NOT NULL
      GROUP BY l.account_id, a.code, a.type
      ORDER BY a.code ASC
    `;

    const res = await query({
      name: 'report_trial_balance',
      text: sql,
      values: [],
    });

    return res.rows.map((row: any) => {
      const type = row.type as AccountType;
      const rawDebitTotal = BigInt(row.debit_total);
      const rawCreditTotal = BigInt(row.credit_total);
      const rawNetBalance = BigInt(row.net_balance);
      const displayDebitTotal = normalizeBalance(type, rawDebitTotal);
      const displayCreditTotal = normalizeBalance(type, rawCreditTotal);
      const displayNetBalance = normalizeBalance(type, rawNetBalance);
      return {
        accountId: row.account_id,
        code: row.code,
        debitTotal: Money.toRupees(displayDebitTotal),
        creditTotal: Money.toRupees(displayCreditTotal),
        netBalance: Money.toRupees(displayNetBalance),
        rawDebitTotal: Money.toRupees(rawDebitTotal),
        rawCreditTotal: Money.toRupees(rawCreditTotal),
        rawNetBalance: Money.toRupees(rawNetBalance),
        normalBalanceSide: normalBalanceSide(type),
      };
    });
  }
}
