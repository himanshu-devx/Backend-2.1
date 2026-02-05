import { runSnapshotJob } from '../scheduler/jobs';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Automates creating balance snapshots.
 * Run this nightly or hourly via Cron.
 */
async function runAutoSnapshot() {
    await runSnapshotJob({
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

runAutoSnapshot();
