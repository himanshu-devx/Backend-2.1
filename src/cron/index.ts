import { startLedgerJobs } from "@/jobs/ledger.jobs";
import { registerProviderFeeSettlementJobs } from "@/cron/provider-fee-settlement.cron";
import { logger } from "@/infra/logger-instance";

/**
 * Register all system-wide cron jobs
 */
export function registerAllCronJobs() {
    logger.info("[CronRegistry] Registering all background jobs...");

    // 1. Ledger Maintenance Jobs
    try {
        startLedgerJobs();
        logger.info("[CronRegistry] Ledger maintenance jobs registered");
    } catch (error: any) {
        logger.error({ error: error.message }, "[CronRegistry] Failed to register Ledger jobs");
    }

    // 2. Provider Fee Settlement Jobs
    try {
        registerProviderFeeSettlementJobs();
        logger.info("[CronRegistry] Provider fee settlement jobs registered");
    } catch (error: any) {
        logger.error({ error: error.message }, "[CronRegistry] Failed to register Provider Fee jobs");
    }

    logger.info("[CronRegistry] All background jobs registered successfully");
}
