import { runOptimizeDbJob } from '../scheduler/jobs';
import * as dotenv from 'dotenv';
dotenv.config();

async function optimize() {
    await runOptimizeDbJob({
        init: {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'ledger',
        },
        autoClose: true,
    });
}

optimize();
