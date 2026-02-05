-- CI Invariants: Corruption Detection
-- Run this script in CI or periodic monitoring.
-- If any query returns a row, the ledger is Corrupted.

-- 1. Double Entry Check
-- Sum of all posted lines in an entry must be 0.
SELECT entry_id, SUM(amount) as imbalance
FROM journal_lines
GROUP BY entry_id
HAVING SUM(amount) <> 0;

-- 2. Balance Integrity Check
-- The sum of all journal lines for an account must equal its current ledger_balance.
-- (Note: This might be expensive on huge datasets, so optimization/chunking is needed for prod, but mandatory for CI/Small scale).
WITH recalculated AS (
    SELECT account_id, SUM(amount) as calc_balance
    FROM journal_lines
    GROUP BY account_id
)
SELECT 
    a.id, 
    a.ledger_balance, 
    COALESCE(r.calc_balance, 0) as recalc
FROM accounts a
LEFT JOIN recalculated r ON a.id = r.account_id
WHERE a.ledger_balance <> COALESCE(r.calc_balance, 0);

-- 3. Closing Balance Traceability Check (The "Blockchain" check)
-- For a given account, ensure ordered lines logically flow.
-- prev_balance + current_amount = current_balance_after
-- This requires window functions ensuring strict ordering.
WITH ordered_lines AS (
    SELECT 
        account_id,
        amount,
        balance_after,
        LAG(balance_after, 1, 0) OVER (PARTITION BY account_id ORDER BY created_at, id) as prev_balance
    FROM journal_lines
)
SELECT *
FROM ordered_lines
WHERE prev_balance + amount <> balance_after;

-- 4. Negative Balance Check (If overdrafts are strictly forbidden globally)
-- Uncomment if this is a strict invariant.
-- SELECT * FROM accounts WHERE ledger_balance < 0;
