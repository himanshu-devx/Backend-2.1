import { getPostgres, connectPostgres } from "./connection";
import { logger } from "@/infra/logger-instance";
import * as fs from "fs";
import * as path from "path";

interface Migration {
  id: number;
  name: string;
  applied_at: Date;
}

export async function runMigrations(): Promise<void> {
  const sql = getPostgres();

  logger.info("Running PostgreSQL ledger migrations...");

  // Create migrations tracking table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS _ledger_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Get applied migrations
  const applied = await sql<Migration[]>`
    SELECT id, name, applied_at FROM _ledger_migrations ORDER BY id
  `;
  const appliedNames = new Set(applied.map((m) => m.name));

  // Get migration files
  const migrationsDir = path.join(__dirname, "migrations");

  // Check if migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    logger.info("No migrations directory found, skipping migrations");
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Apply pending migrations
  for (const file of files) {
    if (appliedNames.has(file)) {
      logger.debug(`Migration ${file} already applied, skipping`);
      continue;
    }

    logger.info(`Applying migration: ${file}`);

    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, "utf-8");

    try {
      // Run migration in a transaction
      await sql.begin(async (tx) => {
        // Execute the migration SQL
        await tx.unsafe(sqlContent);

        // Record the migration
        await tx`
          INSERT INTO _ledger_migrations (name) VALUES (${file})
        `;
      });

      logger.info(`Migration ${file} applied successfully`);
    } catch (error: any) {
      logger.error({ error, file }, `Failed to apply migration ${file}`);
      throw error;
    }
  }

  logger.info("All migrations applied successfully");
}

export async function getMigrationStatus(): Promise<Migration[]> {
  const sql = getPostgres();

  try {
    const migrations = await sql<Migration[]>`
      SELECT id, name, applied_at FROM _ledger_migrations ORDER BY id
    `;
    return migrations;
  } catch {
    return [];
  }
}

// CLI runner
if (require.main === module) {
  (async () => {
    try {
      await connectPostgres();
      await runMigrations();
      process.exit(0);
    } catch (error) {
      console.error("Migration failed:", error);
      process.exit(1);
    }
  })();
}
