import { runVerifyIntegrityJob } from '../scheduler/jobs';

/**
 * Verifies the Cryptographic Integrity of the Ledger.
 * Recomputes hashes and asserts the chain is unbroken.
 */
async function verify() {
    const result = await runVerifyIntegrityJob({
        init: {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'ledger',
        },
        autoClose: true,
        stopOnPending: true,
    });

    if (!result.ok) {
        process.exit(1);
    }
}

verify();
