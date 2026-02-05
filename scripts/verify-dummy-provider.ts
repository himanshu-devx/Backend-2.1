import { bootstrap } from "@/bootstrap";
import { PayinWorkflow } from "@/services/payment/payin.workflow";
import { PayoutWorkflow } from "@/services/payment/payout.workflow";
import { TransactionModel } from "@/models/transaction.model";
import { CacheService } from "@/services/common/cache.service";
import { logger } from "@/infra/logger-instance";

async function verifyDummyProvider() {
    await bootstrap();
    logger.info("=== Starting DummyProvider Verification ===");

    const merchant = await CacheService.getMerchant("MID-1");
    if (!merchant) throw new Error("Merchant MID-1 not found");

    // 1. Test Provider-First Payin with Dummy
    logger.info("\n[Test 1] Executing Provider-First Payin with DummyProvider...");
    const payinWorkflow = new PayinWorkflow(merchant, "127.0.0.1");
    const payinDto = {
        amount: 1000,
        orderId: `TEST_DUMMY_PAYIN_${Date.now()}`,
        paymentMode: "UPI" as any,
        customerName: "Dummy Test User",
        customerEmail: "test@dummy.com",
        customerPhone: "9999999999"
    };

    const payinResult = await payinWorkflow.execute(payinDto);
    logger.info(`✓ Payin Initiated: Transaction ${payinResult.transactionId}`);
    logger.info(`✓ Payment URL: ${payinResult.url}`);

    // Verify DB record
    let txn = await TransactionModel.findOne({ id: payinResult.transactionId });
    if (!txn) throw new Error("Payin transaction NOT found in DB!");
    logger.info(`✓ Initial Status: ${txn.status}`);

    // Wait for async webhook (2 seconds + buffer)
    logger.info("\n⏳ Waiting 3 seconds for DummyProvider webhook...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify webhook processed
    txn = await TransactionModel.findOne({ id: payinResult.transactionId });
    logger.info(`✓ Final Status: ${txn?.status}`);
    if (txn?.status !== "SUCCESS") {
        throw new Error(`Expected SUCCESS, got ${txn?.status}`);
    }

    // 2. Test DB-First Payout with Dummy
    logger.info("\n[Test 2] Executing DB-First Payout with DummyProvider...");
    const payoutWorkflow = new PayoutWorkflow(merchant, "127.0.0.1");
    const payoutDto = {
        amount: 500,
        orderId: `TEST_DUMMY_PAYOUT_${Date.now()}`,
        beneficiaryName: "Test Beneficiary",
        beneficiaryAccountNumber: "1234567890",
        beneficiaryBankIfsc: "SBIN0001234",
        mode: "IMPS" as any
    };

    const payoutResult = await payoutWorkflow.execute(payoutDto);
    logger.info(`✓ Payout Initiated: Transaction ${payoutResult.transactionId}`);

    // Verify DB record
    let payoutTxn = await TransactionModel.findOne({ id: payoutResult.transactionId });
    if (!payoutTxn) throw new Error("Payout transaction NOT found in DB!");
    logger.info(`✓ Initial Status: ${payoutTxn.status}`);

    // Wait for async webhook
    logger.info("\n⏳ Waiting 3 seconds for DummyProvider payout webhook...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify webhook processed
    payoutTxn = await TransactionModel.findOne({ id: payoutResult.transactionId });
    logger.info(`✓ Final Status: ${payoutTxn?.status}`);
    logger.info(`✓ Outcome: ${payoutTxn?.status === "SUCCESS" ? "Bank Accepted" : "Bank Rejected (10% chance)"}`);

    logger.info("\n=== ✅ DummyProvider Verification Complete ===");
    process.exit(0);
}

verifyDummyProvider().catch(err => {
    logger.error(`❌ Verification Failed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
