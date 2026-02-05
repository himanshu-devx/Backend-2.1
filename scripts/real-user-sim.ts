import { bootstrap } from "@/bootstrap";
import { PayinWorkflow } from "@/workflows/payin.workflow";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";

/**
 * Real User Simulation Test
 * 500+ users hitting one by one (independent workers with jitter)
 */

async function realUserSimulation() {
    await bootstrap();
    const merchant = await CacheService.getMerchant("MID-1");
    if (!merchant) throw new Error("Merchant not found");

    const USER_COUNT = 500;
    const TEST_DURATION_SEC = 60;
    const THINK_TIME_MIN_MS = 100; // Min time between a user's transactions
    const THINK_TIME_MAX_MS = 500; // Max time between a user's transactions

    console.log(`=== Real User Simulation ===`);
    console.log(`Users: ${USER_COUNT}`);
    console.log(`Pattern: One-by-one (independent workers)`);
    console.log(`Duration: ${TEST_DURATION_SEC}s\n`);

    let completed = 0;
    let failed = 0;
    let totalLatency = 0;
    const startTime = Date.now();
    const endTime = startTime + (TEST_DURATION_SEC * 1000);

    // Progress reporter
    const reportInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const tps = completed / elapsed;
        const successRate = ((completed / (completed + failed)) * 100) || 0;
        const avgLat = completed > 0 ? totalLatency / completed : 0;
        console.log(`[${elapsed.toFixed(1)}s] Completed: ${completed} | Failed: ${failed} | TPS: ${tps.toFixed(2)} | Avg Lat: ${avgLat.toFixed(2)}ms`);
    }, 2000);

    // Simulated User Task
    const runUserSession = async (userId: number) => {
        while (Date.now() < endTime) {
            const start = Date.now();
            const orderId = `REAL_U${userId}_${Date.now()}`;

            try {
                const workflow = new PayinWorkflow(merchant, "127.0.0.1");
                await workflow.execute({
                    amount: Math.floor(Math.random() * 5000) + 1000,
                    orderId,
                    customerName: `User ${userId}`,
                    customerEmail: `user${userId}@example.com`,
                    customerPhone: "9999999999",
                    paymentMode: "UPI",
                    redirectUrl: "https://example.com/callback"
                });

                const latency = Date.now() - start;
                totalLatency += latency;
                completed++;
            } catch (error) {
                failed++;
            }

            // Real user think time jitter
            const jitter = Math.floor(Math.random() * (THINK_TIME_MAX_MS - THINK_TIME_MIN_MS)) + THINK_TIME_MIN_MS;
            await new Promise(resolve => setTimeout(resolve, jitter));
        }
    };

    // Launch 500 concurrent individual users
    const userPromises = Array.from({ length: USER_COUNT }).map((_, i) => runUserSession(i));

    await Promise.all(userPromises);
    clearInterval(reportInterval);

    const actualDuration = (Date.now() - startTime) / 1000;
    const finalTps = completed / actualDuration;
    const finalAvgLat = completed > 0 ? totalLatency / completed : 0;
    const finalSuccessRate = (completed / (completed + failed)) * 100;

    console.log(`\n=== Final Results ===`);
    console.log(`Total Transactions: ${completed + failed}`);
    console.log(`Successful: ${completed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Success Rate: ${finalSuccessRate.toFixed(2)}%`);
    console.log(`Avg Latency: ${finalAvgLat.toFixed(2)}ms`);
    console.log(`Avg TPS: ${finalTps.toFixed(2)}`);

    process.exit(0);
}

realUserSimulation().catch(console.error);
