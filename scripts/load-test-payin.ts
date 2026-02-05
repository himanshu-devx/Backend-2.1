import { bootstrap } from "@/bootstrap";
import { PayinWorkflow } from "@/workflows/payin.workflow";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";

async function loadTestPayin() {
    await bootstrap();
    console.log("=== Starting Payin Load Test (1 minute) ===\n");

    const merchant = await CacheService.getMerchant("MID-1");
    if (!merchant) throw new Error("Merchant MID-1 not found");

    const testDuration = 60000; // 1 minute
    const batchSize = 10; // Process 10 concurrent transactions at a time
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;
    let totalLatency = 0;

    console.log(`Start Time: ${new Date(startTime).toISOString()}`);
    console.log(`Batch Size: ${batchSize} concurrent transactions\n`);

    while (Date.now() - startTime < testDuration) {
        const batchPromises: Promise<void>[] = [];

        // Create a batch of transactions
        for (let i = 0; i < batchSize; i++) {
            const txnStartTime = Date.now();

            const promise = (async () => {
                try {
                    const workflow = new PayinWorkflow(merchant, "127.0.0.1");
                    const dto = {
                        amount: Math.floor(Math.random() * 10000) + 100,
                        orderId: `LOAD_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        paymentMode: "UPI" as any,
                        customerName: "Load Test",
                        customerEmail: "load@test.com",
                        customerPhone: "9999999999"
                    };

                    await workflow.execute(dto);

                    const latency = Date.now() - txnStartTime;
                    totalLatency += latency;
                    successCount++;
                } catch (error: any) {
                    failureCount++;
                    console.error(`Transaction failed: ${error.message}`);
                }
            })();

            batchPromises.push(promise);
        }

        // Wait for the current batch to complete before starting the next
        await Promise.all(batchPromises);

        // Log progress
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const currentTPS = (successCount / (Date.now() - startTime) * 1000).toFixed(2);
        const avgLatency = successCount > 0 ? (totalLatency / successCount).toFixed(2) : "0";
        console.log(`[${elapsed}s] Completed: ${successCount} | Failed: ${failureCount} | TPS: ${currentTPS} | Avg Latency: ${avgLatency}ms`);
    }

    const endTime = Date.now();
    const actualDuration = (endTime - startTime) / 1000;
    const totalTransactions = successCount + failureCount;
    const tps = (successCount / actualDuration).toFixed(2);
    const avgLatency = successCount > 0 ? (totalLatency / successCount).toFixed(2) : "0";

    console.log("\n=== Load Test Results ===");
    console.log(`Duration: ${actualDuration.toFixed(2)} seconds`);
    console.log(`Total Transactions: ${totalTransactions}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failureCount}`);
    console.log(`Success Rate: ${((successCount / totalTransactions) * 100).toFixed(2)}%`);
    console.log(`\n📊 Performance Metrics:`);
    console.log(`TPS (Transactions Per Second): ${tps}`);
    console.log(`Average Latency: ${avgLatency}ms`);
    console.log(`Total Throughput: ${successCount} transactions in ${actualDuration.toFixed(2)}s`);

    process.exit(0);
}

loadTestPayin().catch(err => {
    console.error(`❌ Load Test Failed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
