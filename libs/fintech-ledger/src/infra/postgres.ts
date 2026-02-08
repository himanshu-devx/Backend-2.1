import { Pool, PoolClient, PoolConfig, QueryResult, QueryConfig } from 'pg';

let pool: Pool | undefined;

/**
 * Initialize the Database Connection Pool
 */
export type LedgerPoolConfig = PoolConfig & {
  timezone?: string;
};

type EnvName = 'production' | 'staging' | 'development' | 'test';

function getEnvName(): EnvName {
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  if (env === 'production' || env === 'staging' || env === 'test') return env;
  return 'development';
}

function getDefaultPoolConfig(): Partial<PoolConfig> {
  const env = getEnvName();
  switch (env) {
    case 'production':
      return { max: 50, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };
    case 'staging':
      return { max: 30, idleTimeoutMillis: 20000, connectionTimeoutMillis: 5000 };
    case 'test':
      return { max: 5, idleTimeoutMillis: 5000, connectionTimeoutMillis: 2000 };
    case 'development':
    default:
      return { max: 10, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 };
  }
}

function getSessionTuning() {
  const env = getEnvName();
  const defaults =
    env === 'production'
      ? { statementTimeoutMs: 30000, lockTimeoutMs: 5000, idleInTxTimeoutMs: 60000 }
      : env === 'test'
        ? { statementTimeoutMs: 10000, lockTimeoutMs: 2000, idleInTxTimeoutMs: 10000 }
        : { statementTimeoutMs: 15000, lockTimeoutMs: 3000, idleInTxTimeoutMs: 20000 };

  return {
    statementTimeoutMs: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '', 10) || defaults.statementTimeoutMs,
    lockTimeoutMs: parseInt(process.env.DB_LOCK_TIMEOUT_MS || '', 10) || defaults.lockTimeoutMs,
    idleInTxTimeoutMs:
      parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || '', 10) || defaults.idleInTxTimeoutMs,
  };
}

export function initConnection(config: LedgerPoolConfig): Pool {
  if (pool) {
    return pool; // Already initialized
  }
  const { timezone, ...pgConfig } = config;
  pool = new Pool({
    ...getDefaultPoolConfig(),
    ...pgConfig,
  });

  // STRICT: Force IST Timezone for all sessions
  pool.on('connect', async (client: PoolClient) => {
    await client.query(`SET timezone = '${timezone || process.env.DB_TIMEZONE || 'Asia/Kolkata'}'`);
    const tuning = getSessionTuning();
    await client.query(`SET statement_timeout = ${tuning.statementTimeoutMs}`);
    await client.query(`SET lock_timeout = ${tuning.lockTimeoutMs}`);
    await client.query(`SET idle_in_transaction_session_timeout = ${tuning.idleInTxTimeoutMs}`);
  });
  return pool;
}

// Fallback for Legacy/Env-based usage
function getPool(): Pool {
  if (!pool) {
    // Auto-init from ENV if not explicitly initialized
    pool = new Pool({
      ...getDefaultPoolConfig(),
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'ledger',
    });

    // STRICT: Force IST Timezone for all sessions
    pool.on('connect', async (client: PoolClient) => {
      await client.query(`SET timezone = '${process.env.DB_TIMEZONE || 'Asia/Kolkata'}'`);
      const tuning = getSessionTuning();
      await client.query(`SET statement_timeout = ${tuning.statementTimeoutMs}`);
      await client.query(`SET lock_timeout = ${tuning.lockTimeoutMs}`);
      await client.query(`SET idle_in_transaction_session_timeout = ${tuning.idleInTxTimeoutMs}`);
    });
  }
  return pool;
}

export const dbProperties = {
  get pool(): Pool {
    return getPool();
  },
};

export function isInitialized(): boolean {
  return Boolean(pool);
}

/**
 * Execute a query with a managed client from the pool
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query(text: string | QueryConfig, params?: any[]): Promise<QueryResult> {
  return getPool().query(text as any, params);
}

/**
 * Get a dedicated client for transactions
 */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

/**
 * Closes the pool (shutdown)
 */
export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
