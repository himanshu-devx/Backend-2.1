import { bootstrap } from "@/bootstrap";
import { PayinWorkflow } from "@/workflows/payin.workflow";
import { CacheService } from "@/services/common/cache.service";
import { TransactionModel } from "@/models/transaction.model";

async function testSinglePayin() {
    await bootstrap();
    console.log("=== Testing Single Payin Transaction ===\n");

    const merchant = await CacheService.getMerchant("MID-1");
    if (!merchant) throw new Error("Merchant MID-1 not found");

    const workflow = new PayinWorkflow(merchant, "127.0.0.1");
    const dto = {
        amount: 1000,
        orderId: `TEST_SINGLE_${Date.now()}`,
        paymentMode: "UPI" as any,
        customerName: "Test User",
        customerEmail: "test@example.com",
        customerPhone: "9999999999"
    };

    console.log("Initiating payin transaction...");
    const startTime = Date.now();

    const result = await workflow.execute(dto);

    const latency = Date.now() - startTime;

    console.log("\n✅ Transaction Successful!");
    console.log(`Transaction ID: ${result.transactionId}`);
    console.log(`Order ID: ${dto.orderId}`);
    console.log(`Payment URL: ${result.url}`);
    console.log(`Latency: ${latency}ms`);

    // Verify in database
    const txn = await TransactionModel.findOne({ id: result.transactionId });
    console.log(`\nDatabase Status: ${txn?.status}`);
    console.log(`Amount: ${txn?.amount}`);
    console.log(`Net Amount: ${txn?.netAmount}`);

    process.exit(0);
}

testSinglePayin().catch(err => {
    console.error(`❌ Test Failed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
