import { connectMongo } from "./infra/mongoose-instance";
import { logger } from "./infra/logger-instance";
import { LedgerService } from "@/services/ledger/ledger.service";

export async function bootstrap() {
  await connectMongo();

  try {
    LedgerService.init();
  } catch (err: any) {
    logger.error("Failed to initialize ledger: " + err.message);
    process.exit(1);
  }

  logger.info("Bootstrap initialized");
}
