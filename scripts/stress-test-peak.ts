import { bootstrap } from "@/bootstrap";
import { PayinWorkflow } from "@/workflows/payin.workflow";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";

/**
 * Peak Load Stress Test
 * Progressively increases load to find maximum system capacity
 */

async function stressTest() {
    await bootstrap();
    const merchant = await CacheService.getMerchant("MID-1");
    if (!merchant) throw new Error("Merchant not found");

    console.log("=== Peak Load Stress Test ===\n");
    console.log("Finding maximum system capacity...\n");

    const testDuration = 30; // 30 seconds for the ultimate test
    const levels = [
        { batchSize: 2000, interval: 30, name: "ULTRA STAGE (60000+ TPS target)" },
        { batchSize: 5000, interval: 30, name: "BREAKING STAGE (150000+ TPS target)" },
    ];

    const results: any[] = [];

    for (const level of levels) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`Testing: ${level.name}`);
        console.log(`Batch Size: ${level.batchSize} | Interval: ${level.interval}ms`);
        console.log(`${"=".repeat(60)}\n`);

        const levelResult = await runLoadLevel(merchant, level.batchSize, level.interval, testDuration);
        results.push({
            ...level,
            ...levelResult
        });

        console.log(`\n✅ Level Complete:`);
        console.log(`   TPS: ${levelResult.tps.toFixed(2)}`);
        console.log(`   Success Rate: ${levelResult.successRate.toFixed(2)}%`);
        console.log(`   Avg Latency: ${levelResult.avgLatency.toFixed(2)}ms`);
        console.log(`   Failed: ${levelResult.failed}`);

        // Stop if success rate drops below 50%
        if (levelResult.successRate < 50) {
            console.log(`\n⚠️  Success rate dropped below 50%. System completely broken.`);
            break;
        }

        // Brief pause between levels
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Print final summary
    console.log(`\n\n${"=".repeat(60)}`);
    console.log("STRESS TEST SUMMARY");
    console.log(`${"=".repeat(60)}\n`);

    console.log("Level | Batch | TPS    | Success% | Latency | Failed");
    console.log("-".repeat(60));
    results.forEach((r, i) => {
        const status = r.successRate >= 99 ? "✅" : r.successRate >= 95 ? "⚠️ " : "❌";
        console.log(
            `${status} ${i + 1}   | ${r.batchSize.toString().padEnd(5)} | ` +
            `${r.tps.toFixed(2).padEnd(6)} | ${r.successRate.toFixed(2).padEnd(8)} | ` +
            `${r.avgLatency.toFixed(2).padEnd(7)}ms | ${r.failed}`
        );
    });

    // Find peak performance
    const peakResult = results.reduce((max, r) =>
        r.successRate >= 99 && r.tps > max.tps ? r : max
        , results[0]);

    console.log(`\n${"=".repeat(60)}`);
    console.log("🏆 PEAK PERFORMANCE");
    console.log(`${"=".repeat(60)}`);
    console.log(`Maximum TPS: ${peakResult.tps.toFixed(2)}`);
    console.log(`Batch Size: ${peakResult.batchSize}`);
    console.log(`Success Rate: ${peakResult.successRate.toFixed(2)}%`);
    console.log(`Latency: ${peakResult.avgLatency.toFixed(2)}ms`);
    console.log(`\nDaily Capacity: ${(peakResult.tps * 86400).toLocaleString()} transactions`);
    console.log(`Monthly Capacity: ${(peakResult.tps * 86400 * 30).toLocaleString()} transactions`);

    process.exit(0);
}

async function runLoadLevel(merchant: any, batchSize: number, interval: number, duration: number) {
    let completed = 0;
    let failed = 0;
    let totalLatency = 0;
    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    let batchCounter = 0;

    const runBatch = async () => {
        const batchPromises: Promise<void>[] = [];
        const batchStart = Date.now();

        for (let i = 0; i < batchSize; i++) {
            const orderId = `STRESS_${Date.now()}_${batchCounter}_${i}`;
            const amount = Math.floor(Math.random() * 9000) + 1000;

            const promise = (async () => {
                const txnStart = Date.now();
                try {
                    const workflow = new PayinWorkflow(merchant, "127.0.0.1");
                    await workflow.execute({
                        amount,
                        orderId,
                        customerName: "Stress Test",
                        customerEmail: "stress@test.com",
                        customerPhone: "9999999999",
                        paymentMode: "UPI",
                        redirectUrl: "https://example.com/callback"
                    });
                    const latency = Date.now() - txnStart;
                    totalLatency += latency;
                    completed++;
                } catch (error: any) {
                    failed++;
                }
            })();

            batchPromises.push(promise);
        }

        await Promise.all(batchPromises);
        batchCounter++;
    };

    // Run batches at specified interval
    while (Date.now() < endTime) {
        await runBatch();
        await new Promise(resolve => setTimeout(resolve, interval));
    }

    const actualDuration = (Date.now() - startTime) / 1000;
    const tps = completed / actualDuration;
    const avgLatency = completed > 0 ? totalLatency / completed : 0;
    const successRate = ((completed / (completed + failed)) * 100) || 0;

    return {
        completed,
        failed,
        tps,
        avgLatency,
        successRate,
        duration: actualDuration
    };
}

stressTest().catch(console.error);
