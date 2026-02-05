import { dbProperties } from '../infra/postgres';
import { Ledger } from '../core/Ledger';
import { AccountType, AccountStatus } from '../api/types';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../infra/logger';

const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');
const PARTITIONS_PATH = path.resolve(__dirname, 'partitions.sql');

export async function autoMigrate(): Promise<void> {
    const isMigrated = await checkSchema();

    if (!isMigrated) {
        logger.info('[FintechLedger] Schema missing. Running auto-migration...');
        await runSchemaMigration();
    }
}

async function checkSchema(): Promise<boolean> {
    try {
        const pool = dbProperties.pool;
        if (!pool) throw new Error("Database pool not initialized");

        const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'accounts'
      );
    `);
        return result.rows[0].exists;
    } catch (err) {
        logger.error({ err }, '[FintechLedger] Error checking schema existence');
        throw err;
    }
}

async function runSchemaMigration() {
    const pool = dbProperties.pool;
    if (!pool) throw new Error("Database pool not initialized");

    try {
        if (!fs.existsSync(SCHEMA_PATH)) {
            throw new Error(`Migration file not found: ${SCHEMA_PATH}`);
        }

        const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
        const partitionsSql = fs.readFileSync(PARTITIONS_PATH, 'utf-8');

        await pool.query('BEGIN');

        // Execute Schema
        await pool.query(schemaSql);

        // Execute Partitions
        await pool.query(partitionsSql);

        await pool.query('COMMIT');
        logger.info('[FintechLedger] Migration completed successfully.');
    } catch (err) {
        await pool.query('ROLLBACK');
        logger.error({ err }, '[FintechLedger] Migration failed');
        throw err;
    }
}

export async function seedAccounts(ledger: Ledger) {
    const roots = [
        { id: 'assets', code: '1000', type: AccountType.ASSET, name: 'Assets' },
        { id: 'liabilities', code: '2000', type: AccountType.LIABILITY, name: 'Liabilities' },
        { id: 'equity', code: '3000', type: AccountType.EQUITY, name: 'Equity' },
        { id: 'revenue', code: '4000', type: AccountType.INCOME, name: 'Revenue' },
        { id: 'expenses', code: '5000', type: AccountType.EXPENSE, name: 'Expenses' },
    ];

    for (const root of roots) {
        try {
            const existing = await ledger.getAccount(root.id);
            if (!existing) throw new Error("Account missing");
        } catch (err) {
            try {
                await ledger.createAccount(
                    root.id,
                    root.code,
                    root.type,
                    false, // allowOverdraft
                    undefined, // parentId
                    true, // isHeader
                    AccountStatus.ACTIVE,
                    '0',
                    'system-seed'
                );
                logger.info(`[FintechLedger] Seeded account: ${root.name}`);
            } catch (createErr: any) {
                if (createErr.code !== '23505') {
                    logger.warn({ err: createErr }, `[FintechLedger] Failed to seed ${root.id}`);
                }
            }
        }
    }
}
