import { runSealLedgerJob } from '../scheduler/jobs';

/**
 * Async Sealer (Notary).
 * Connects the hash chain for high-throughput writes.
 */
async function seal() {
    await runSealLedgerJob({
        init: {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'ledger',
        },
        autoClose: true,
        batchSize: 100,
    });
}

seal();
