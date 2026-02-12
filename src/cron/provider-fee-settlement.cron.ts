import { CronJob } from "cron";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";
import { ProviderFeeSettlementService } from "@/services/provider-fee-settlement/provider-fee-settlement.service";
import { JobQueue } from "@/utils/job-queue.util";

/**
 * Register all provider fee settlement related cron jobs
 */
export function registerProviderFeeSettlementJobs() {
    // 1. EOD Settlement Enqueue (runs at 1 AM by default)
    new CronJob(
        ENV.CRON_PROVIDER_FEE_SETTLEMENT || "0 0 1 * * *",
        async () => {
            try {
                await ProviderFeeSettlementService.enqueueEodSettlement();
            } catch (error: any) {
                logger.error({ error: error.message }, "[Cron] EOD Settlement enqueue failed");
            }
        },
        null,
        true,
        "Asia/Kolkata"
    );

    // 2. Settlement Verification (runs at 2 AM by default)
    new CronJob(
        ENV.CRON_SETTLEMENT_VERIFICATION || "0 0 2 * * *",
        async () => {
            try {
                // Verification jobs can also be enqueued for horizontal scaling
                await JobQueue.enqueue({
                    type: "SETTLEMENT_VERIFICATION",
                    payload: {}
                });
            } catch (error: any) {
                logger.error({ error: error.message }, "[Cron] Settlement verification enqueue failed");
            }
        },
        null,
        true,
        "Asia/Kolkata"
    );

    logger.info("[Cron] Provider Fee Settlement jobs registered");
}
