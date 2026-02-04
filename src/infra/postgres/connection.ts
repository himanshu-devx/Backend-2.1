import postgres from "postgres";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";

let sql: postgres.Sql | null = null;

export async function connectPostgres(): Promise<postgres.Sql> {
  if (sql) return sql;

  logger.info("Connecting to PostgreSQL Ledger Database...");

  sql = postgres(ENV.POSTGRES_LEDGER_URL, {
    max: ENV.POSTGRES_POOL_SIZE,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: {
      undefined: null,
    },
    types: {
      // Handle BigInt serialization for monetary amounts
      bigint: postgres.BigInt,
    },
    onnotice: (notice) => {
      logger.debug({ notice }, "PostgreSQL Notice");
    },
  });

  // Test connection
  try {
    await sql`SELECT 1 as health_check`;
    logger.info("PostgreSQL Ledger Database connected successfully");
  } catch (error) {
    logger.error({ error }, "Failed to connect to PostgreSQL Ledger Database");
    throw error;
  }

  return sql;
}

export function getPostgres(): postgres.Sql {
  if (!sql) {
    throw new Error("PostgreSQL not initialized. Call connectPostgres() first.");
  }
  return sql;
}

export async function closePostgres(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    logger.info("PostgreSQL connection closed");
  }
}

export { sql };
