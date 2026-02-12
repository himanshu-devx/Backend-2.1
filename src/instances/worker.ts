import { bootstrap } from "@/bootstrap";
import { registerAllCronJobs } from "@/cron/index";
import { BackgroundWorker } from "@/workers/background.worker";
import { logger } from "@/infra/logger-instance";

async function main() {
    logger.info("[WorkerInstance] Initializing Background Services...");

    try {
        await bootstrap();

        // 1. Start all scheduled tasks (Crons)
        registerAllCronJobs();

        // 2. Start all polling processes (Workers)
        await BackgroundWorker.start();

    } catch (error: any) {
        logger.error({ error: error.message }, "[WorkerInstance] Fatal error during startup");
        process.exit(1);
    }
}

main();
