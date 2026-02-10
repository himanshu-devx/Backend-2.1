import { query } from '../infra/postgres';
import { AccountId, AccountType } from '../api/types';
import { normalizeBalance, normalBalanceSide } from '../utils/Accounting';
import { Money } from '../utils/Money';

export interface StatementLine {
  date: Date;
  entryId: string;
  description: string;
  amount: string;
  balanceAfter: string;
  rawAmount: string;
  rawBalanceAfter: string;
  normalBalanceSide: 'DEBIT' | 'CREDIT';
}

export class AccountStatement {
  async getStatement(accountId: AccountId, limit = 100): Promise<StatementLine[]> {
    const sql = `
      SELECT 
        l.created_at,
        l.entry_id,
        e.description,
        l.amount,
        l.balance_after,
        a.type
      FROM journal_lines l
      JOIN journal_entries e ON l.entry_id = e.id
      JOIN accounts a ON l.account_id = a.id
      WHERE l.account_id = $1
      AND e.posted_at IS NOT NULL
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $2
    `;

    const res = await query({
      name: 'report_account_statement',
      text: sql,
      values: [accountId, limit],
    });

    return res.rows.map((row: any) => {
      const type = row.type as AccountType;
      const rawAmount = BigInt(row.amount);
      const rawBalanceAfter = BigInt(row.balance_after);
      const displayAmount = normalizeBalance(type, rawAmount);
      const displayBalanceAfter = normalizeBalance(type, rawBalanceAfter);
      return {
        date: row.created_at,
        entryId: row.entry_id,
        description: row.description,
        amount: Money.toRupees(displayAmount),
        balanceAfter: Money.toRupees(displayBalanceAfter),
        rawAmount: Money.toRupees(rawAmount),
        rawBalanceAfter: Money.toRupees(rawBalanceAfter),
        normalBalanceSide: normalBalanceSide(type),
      };
    });
  }
}
