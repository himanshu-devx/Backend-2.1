import { query } from '../infra/postgres';
import { AccountType } from '../api/types';
import { normalizeBalance } from '../utils/Accounting';
import { Money } from '../utils/Money';

interface BalanceNodeInternal {
  id: string;
  code: string;
  type: AccountType;
  level: number;
  balance: bigint;
  rawBalance: bigint;
  children: BalanceNodeInternal[];
}

interface BalanceNode {
  id: string;
  code: string;
  type: AccountType;
  level: number;
  balance: string;
  rawBalance: string;
  children: BalanceNode[];
}

export class BalanceSheet {
  /**
   * Generates a hierarchical balance sheet.
   * Note: This implementation assumes a manageable number of accounts (fetch all & build tree).
   * For millions of accounts, use Recursive CTEs or Materialized Paths.
   */
  async generate(): Promise<BalanceNode[]> {
    // 1. Fetch all accounts
    const res = await query({
      name: 'report_balance_sheet_accounts',
      text: `
        SELECT id, code, type, parent_id, ledger_balance 
        FROM accounts 
        ORDER BY code ASC
    `,
      values: [],
    });

    const nodes = new Map<string, BalanceNodeInternal>();
    const roots: BalanceNodeInternal[] = [];

    // 2. Initialize Nodes
    for (const row of res.rows) {
      const rawBalance = BigInt(row.ledger_balance);
      const display = normalizeBalance(row.type as AccountType, rawBalance);
      nodes.set(row.id, {
        id: row.id,
        code: row.code,
        type: row.type as AccountType,
        level: 0,
        balance: display,
        rawBalance,
        children: [],
      });
    }

    // 3. Build Tree
    for (const row of res.rows) {
      const node = nodes.get(row.id)!;
      if (row.parent_id) {
        const parent = nodes.get(row.parent_id);
        if (parent) {
          parent.children.push(node);
          node.level = parent.level + 1; // Simplistic level calc
        } else {
          // Orphan -> Treat as root
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    // 4. Rollup Balances (Post-order traversal)
    this.rollup(roots);

    return this.toDisplayNodes(roots);
  }

  private rollup(nodes: BalanceNodeInternal[]): bigint {
    let sum = 0n;
    for (const node of nodes) {
      const childSum = this.rollup(node.children);
      // If header (technically logic should be: if is_header, balance is sum of children)
      // For now, simple additive: Node Balance + Children Balance
      // A pure header should have 0 own balance.
      node.balance += childSum;
      sum += node.balance;
    }
    return sum;
  }

  private toDisplayNodes(nodes: BalanceNodeInternal[]): BalanceNode[] {
    return nodes.map((node) => ({
      id: node.id,
      code: node.code,
      type: node.type,
      level: node.level,
      balance: Money.toRupees(node.balance),
      rawBalance: Money.toRupees(node.rawBalance),
      children: this.toDisplayNodes(node.children),
    }));
  }

  /**
   * Formats the tree into a printable string
   */
  print(nodes: BalanceNode[], indent = 0): string {
    let output = '';
    for (const node of nodes) {
      const spaces = '  '.repeat(indent);
      output += `${spaces}${node.code} (${node.type}): ${node.balance}\n`;
      output += this.print(node.children, indent + 1);
    }
    return output;
  }
}
