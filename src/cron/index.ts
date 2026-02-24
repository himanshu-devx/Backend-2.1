import { startLedgerJobs } from "@/jobs/ledger.jobs";
import { registerProviderFeeSettlementJobs } from "@/cron/provider-fee-settlement.cron";
import { registerPayinExpirySweepJob } from "@/cron/payin-expiry.cron";
import { logger } from "@/infra/logger-instance";
import { ENV } from "@/config/env";

/**
 * Register all system-wide cron jobs
 */
export function registerAllCronJobs() {
    logger.info("[CronRegistry] Registering all background jobs...");
    logger.info(
        {
            ledger: {
                sealer: ENV.CRON_LEDGER_SEALER,
                snapshot: ENV.CRON_LEDGER_SNAPSHOT,
                integrity: ENV.CRON_LEDGER_INTEGRITY,
                optimize: ENV.CRON_LEDGER_OPTIMIZE,
                eod: ENV.CRON_LEDGER_EOD,
            },
            providerFeeSettlement: ENV.CRON_PROVIDER_FEE_SETTLEMENT,
            settlementVerification: ENV.CRON_SETTLEMENT_VERIFICATION,
            payinExpirySweep: ENV.CRON_PAYIN_EXPIRY_SWEEP,
            payinAutoExpireMinutes: ENV.PAYIN_AUTO_EXPIRE_MINUTES,
        },
        "[CronRegistry] Schedule config"
    );

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

    // 3. Payin Expiry Sweep Job (safety net)
    try {
        registerPayinExpirySweepJob();
        logger.info("[CronRegistry] Payin expiry sweep job registered");
    } catch (error: any) {
        logger.error({ error: error.message }, "[CronRegistry] Failed to register Payin expiry sweep job");
    }

    logger.info("[CronRegistry] All background jobs registered successfully");
}
