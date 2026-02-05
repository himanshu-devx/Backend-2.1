import { CronJob } from "cron";
import { LedgerService } from "@/services/ledger/ledger.service";
import { AuditService } from "@/services/common/audit.service";
import { ActorType } from "@/types/audit-log.types";
import { withCronAudit } from "@/utils/cron-wrapper";
import { ENV } from "@/config/env";

const ACTOR_TYPE_SYSTEM: ActorType = "SYSTEM";
const ACTOR_ID = "cron-scheduler";
const SOURCE = "ledger-cron";

// Cron Timings
const SEALER_CRON = ENV.CRON_LEDGER_SEALER; // Default: Every 5 seconds
const SNAPSHOT_CRON = ENV.CRON_LEDGER_SNAPSHOT; // Default: Hourly
const INTEGRITY_CHECK_CRON = ENV.CRON_LEDGER_INTEGRITY; // Default: Every 6 hours
const OPTIMIZE_DB_CRON = ENV.CRON_LEDGER_OPTIMIZE; // Default: Daily at midnight
const EOD_REBUILD_CRON = ENV.CRON_LEDGER_EOD; // Default: Daily at 23:30

export function startLedgerJobs() {
    AuditService.record({
        action: "CRON_SYSTEM_START",
        actorType: ACTOR_TYPE_SYSTEM,
        actorId: ACTOR_ID,
        source: SOURCE,
        metadata: { message: "Dedicated Ledger Cron Jobs Initialized." },
    });

    // 1. Ledger Sealer
    new CronJob(
        SEALER_CRON,
        () =>
            withCronAudit(
                "SEALER",
                async () => {
                    await LedgerService.runSealLedgerJob({ batchSize: 500 });
                },
                { logStart: false, logSuccess: false } // Too frequent for success logs
            ),
        null,
        true
    );

    // 2. Snapshot Job
    new CronJob(
        SNAPSHOT_CRON,
        () =>
            withCronAudit("SNAPSHOT", async () => {
                await LedgerService.runSnapshotJob();
            }),
        null,
        true
    );

    // 3. Integrity Check
    new CronJob(
        INTEGRITY_CHECK_CRON,
        () =>
            withCronAudit("INTEGRITY_CHECK", async () => {
                await LedgerService.runIntegrityChecksJob();
            }),
        null,
        true
    );

    // 4. Optimize DB
    new CronJob(
        OPTIMIZE_DB_CRON,
        () =>
            withCronAudit("OPTIMIZE_DB", async () => {
                await LedgerService.runOptimizeDbJob();
            }),
        null,
        true
    );

    // 5. EOD Rebuild
    new CronJob(
        EOD_REBUILD_CRON,
        () =>
            withCronAudit("EOD_REBUILD", async () => {
                await LedgerService.runEodRebuildJob();
            }),
        null,
        true
    );

    AuditService.record({
        action: "CRON_SYSTEM_READY",
        actorType: ACTOR_TYPE_SYSTEM,
        actorId: ACTOR_ID,
        source: SOURCE,
        metadata: { message: "Dedicated Ledger Cron Jobs Initialized." },
    });
}
