import { AuditService } from "@/services/common/audit.service";
import { ActorType } from "@/types/audit-log.types";

const ACTOR_TYPE_SYSTEM: ActorType = "SYSTEM";
const ACTOR_ID = "cron-scheduler";
const SOURCE = "ledger-cron";

/**
 * Wraps a cron job function with standardized audit logging.
 * Logs JOB_STARTED, JOB_COMPLETED, and JOB_FAILED events.
 *
 * @param jobName - The name of the job (e.g. "SNAPSHOT")
 * @param jobFn - The async function to execute
 * @param config - Configuration options (logStart, logSuccess)
 */
export async function withCronAudit(
    jobName: string,
    jobFn: () => Promise<void>,
    config: { logStart?: boolean; logSuccess?: boolean } = {
        logStart: true,
        logSuccess: true,
    }
) {
    if (config.logStart) {
        try {
            await AuditService.record({
                action: "JOB_STARTED",
                actorType: ACTOR_TYPE_SYSTEM,
                actorId: ACTOR_ID,
                entityType: "JOB",
                entityId: jobName,
                source: SOURCE,
            });
        } catch (error) {
            console.error(`[CronWrapper] Failed to audit start of ${jobName}`, error);
        }
    }

    try {
        await jobFn();

        if (config.logSuccess) {
            try {
                await AuditService.record({
                    action: "JOB_COMPLETED",
                    actorType: ACTOR_TYPE_SYSTEM,
                    actorId: ACTOR_ID,
                    entityType: "JOB",
                    entityId: jobName,
                    source: SOURCE,
                });
            } catch (error) {
                console.error(`[CronWrapper] Failed to audit success of ${jobName}`, error);
            }
        }
    } catch (err: any) {
        try {
            await AuditService.record({
                action: "JOB_FAILED",
                actorType: ACTOR_TYPE_SYSTEM,
                actorId: ACTOR_ID,
                entityType: "JOB",
                entityId: jobName,
                source: SOURCE,
                metadata: { error: err.message, stack: err.stack },
            });
        } catch (error) {
            console.error(`[CronWrapper] Failed to audit failure of ${jobName}`, error);
        }
    }
}
