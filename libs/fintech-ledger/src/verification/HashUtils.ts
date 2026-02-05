import { createHash } from 'crypto';

export function computeEntryHash(
    previousHash: string | null,
    entryId: string,
    postedAt: Date | null,
    description: string,
    lines: { accountId: string; amount: bigint }[]
): string {
    const hash = createHash('sha256');

    hash.update(previousHash || 'GENESIS');
    hash.update(entryId);
    if (postedAt) hash.update(postedAt.toISOString());
    hash.update(description);

    // Deterministic Lines Sorting for Hash Consistency
    const sortedLines = [...lines].sort((a, b) => a.accountId.localeCompare(b.accountId));
    hash.update(JSON.stringify(sortedLines, (_, v) => typeof v === 'bigint' ? v.toString() : v));

    return hash.digest('hex');
}
