import { runResetDbJob } from '../scheduler/jobs';

async function reset() {
    await runResetDbJob({
        init: {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'ledger',
        },
        autoClose: true,
    });
}

reset().catch(console.error);
