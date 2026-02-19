import { connectMongo } from "./infra/mongoose-instance";
import { logger } from "./infra/logger-instance";
import { LedgerService } from "@/services/ledger/ledger.service";
import { ReportService } from "@/services/common/report.service";
import { emailService } from "@/infra/email";
import { ENV } from "@/config/env";
import {
  recordSecurityConfigSnapshot,
  validateSecurityConfig,
} from "@/utils/security-config.util";
import { AuditSink } from "@/services/common/audit-sink.service";

export async function bootstrap() {
  validateSecurityConfig();
  await AuditSink.init();
  await recordSecurityConfigSnapshot();

  await connectMongo();

  try {
    await LedgerService.init({
      host: ENV.POSTGRES_HOST,
      port: Number(ENV.POSTGRES_PORT),
      user: ENV.POSTGRES_USER,
      password: ENV.POSTGRES_PASSWORD,
      database: ENV.POSTGRES_DB,
      max: Number(ENV.POSTGRES_POOL_MAX || "20"),
    });

    logger.info("Ledger initialized");

    ReportService.setEmailService(emailService);
    logger.info("ReportService initialized");

  } catch (err: any) {
    logger.error("Failed to initialize ledger: " + err.message);
    process.exit(1);
  }

  logger.info("Bootstrap initialized");
}
