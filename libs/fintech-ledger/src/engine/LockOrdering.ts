import { AccountId } from '../api/types';

/**
 * Returns a deduplicated, sorted list of Account IDs.
 * Used to ensure deterministic locking order and prevent deadlocks.
 */
export function getLockOrder(accountIds: AccountId[]): AccountId[] {
  // 1. Deduplicate
  const unique = Array.from(new Set(accountIds));

  // 2. Sort (String comparison is sufficient for deterministic ordering)
  unique.sort((a, b) => a.localeCompare(b));

  return unique;
}
