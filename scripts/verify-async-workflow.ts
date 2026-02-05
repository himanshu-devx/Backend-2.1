import { bootstrap } from "@/bootstrap";
import { PayinWorkflow } from "@/services/payment/payin.workflow";
import { PayoutWorkflow } from "@/services/payment/payout.workflow";
import { WebhookQueue } from "@/utils/webhook-queue.util";
import { TransactionModel } from "@/models/transaction.model";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";

async function verifyAsyncWorkflow() {
    await bootstrap();
    logger.info("--- Starting Async Workflow Verification ---");

    const merchant = await CacheService.getMerchant("MID-1");
    if (!merchant) throw new Error("Merchant MID-1 not found");

    // 1. Test Provider-First Payin
    logger.info("[Test 1] Executing Provider-First Payin...");
    const payinWorkflow = new PayinWorkflow(merchant, "127.0.0.1");
    const payinDto = {
        amount: 500,
        orderId: `TEST_PAYIN_${Date.now()}`,
        paymentMode: "UPI" as any,
        customerName: "Async Tester",
        customerEmail: "tester@async.com",
        customerPhone: "9999999999"
    };

    const payinResult = await payinWorkflow.execute(payinDto);
    logger.info(`Payin Success: Transaction ${payinResult.transactionId} created.`);

    const txnInDb = await TransactionModel.findOne({ id: payinResult.transactionId });
    if (!txnInDb) throw new Error("Payin transaction NOT found in DB!");
    logger.info(`Payin Record Confirmed: ID ${txnInDb.id}, Status ${txnInDb.status}`);


    // 2. Test Async Webhook Production
    logger.info("[Test 2] Simulating Webhook Reception...");
    const samplePayload = {
        payment_id: "EXT_" + Date.now(),
        status: "SUCCESS",
        amount: 500,
        ref_id: payinResult.transactionId // Use our generated ID
    };

    // Queue directly (Simulating Controller)
    await WebhookQueue.enqueue({
        providerId: "ALPHAPAY",
        legalEntityId: "PLE-1",
        type: "PAYIN",
        payload: samplePayload
    });

    logger.info(`Webhook enqueued to Redis.`);

    const qLen = await WebhookQueue.getLength();
    logger.info(`Current Queue Length: ${qLen}`);

    logger.info("--- Verification Script Completed Successfully ---");
    process.exit(0);
}

verifyAsyncWorkflow().catch(err => {
    logger.error(`Verification Failed: ${err.message}`);
    process.exit(1);
});
