import { CronJob } from "cron";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";
import { TransactionMonitorService } from "@/services/payment/transaction-monitor.service";

/**
 * Safety-net cron to expire stale payins in case delayed jobs were missed.
 */
export function registerPayinExpirySweepJob() {
    const schedule = ENV.CRON_PAYIN_EXPIRY_SWEEP || "0 */5 * * * *";

    new CronJob(
        schedule,
        async () => {
            try {
                await TransactionMonitorService.sweepExpiredPayins();
            } catch (error: any) {
                logger.error({ error: error.message }, "[Cron] Payin expiry sweep failed");
            }
        },
        null,
        true,
        "Asia/Kolkata"
    );

    logger.info({ schedule }, "[Cron] Payin expiry sweep job registered");
}
