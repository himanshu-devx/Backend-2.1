import { connectMongo } from "./infra/mongoose-instance";
import { logger } from "./infra/logger-instance";
import { TigerBeetleService } from "@/services/ledger/tigerbeetle.service";
import { connectPostgres } from "@/infra/postgres/connection";
import { runMigrations } from "@/infra/postgres/migrate";
import { ENV } from "@/config/env";

export async function bootstrap() {
  // Connect to MongoDB (primary data store)
  await connectMongo();
  logger.info("MongoDB connected");

  // Connect to PostgreSQL (ledger database)
  try {
    await connectPostgres();
    logger.info("PostgreSQL Ledger connected");

    // Run migrations automatically
    await runMigrations();
  } catch (err: any) {
    logger.error("Failed to connect to PostgreSQL Ledger: " + err.message);
    // PostgreSQL is required for the new architecture
    process.exit(1);
  }

  // TigerBeetle connection (legacy - kept for migration period)
  // Can be disabled once migration to PostgreSQL ledger is complete
  const isBun = !!(process.versions as any).bun;
  const isWindows = process.platform === "win32";
  const useTigerBeetle = ENV.TIGERBEETLE_REPLICA_ADDRESSES && ENV.TIGERBEETLE_REPLICA_ADDRESSES !== "3000";

  if (useTigerBeetle && (!isBun || !isWindows)) {
    try {
      await TigerBeetleService.connect();
      logger.info("TigerBeetle connected (legacy)");
    } catch (err: any) {
      // TigerBeetle is optional during migration
      logger.warn("TigerBeetle connection skipped: " + err.message);
    }
  }

  logger.info("Bootstrap initialized");
}
