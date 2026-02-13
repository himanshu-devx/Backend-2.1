
import { mongoose } from "./src/infra/mongoose-instance";
import { LedgerService } from "./src/services/ledger/ledger.service";
import { LedgerOperationService } from "./src/services/ledger/ledger-operation.service";
import { ProviderLegalEntityModel } from "./src/models/provider-legal-entity.model";
import { ENV } from "./src/config/env";
import { LEDGER_OPERATION } from "./src/constants/ledger-operations.constant";

async function verifyReversal() {
    console.log("🚀 Starting Verification of PLE Ledger Reversal...");

    try {
        await mongoose.connect(ENV.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        console.log("✅ Mongo Connected");

        await LedgerService.init({
            host: ENV.POSTGRES_HOST,
            port: parseInt(ENV.POSTGRES_PORT as string, 10),
            user: ENV.POSTGRES_USER,
            password: ENV.POSTGRES_PASSWORD,
            database: ENV.POSTGRES_DB,
            max: 5
        });
        console.log("✅ Postgres Connected");

        // 1. Get a PLE
        const ple = await ProviderLegalEntityModel.findOne().lean();
        if (!ple) {
            console.error("❌ No PLE found to test with.");
            process.exit(1);
        }
        console.log(`ℹ️ Using PLE: ${ple.id}`);
        console.log(`   Payin Acc: ${ple.accounts?.payinAccountId}`);
        console.log(`   Expense Acc: ${ple.accounts?.expenseAccountId}`);

        // 2. Execute PLE_PAYIN_FEE_CHARGE
        // Expected: FROM Expense -> TO Payin
        console.log("🔄 Executing PLE_PAYIN_FEE_CHARGE...");

        try {
            const result = await LedgerOperationService.createOperation({
                operation: LEDGER_OPERATION.PLE_PAYIN_FEE_CHARGE,
                amount: 10,
                currency: "INR",
                providerLegalEntityId: ple.id,
                narration: "Test Reversal Verify",
                metadata: { test: "reversal" }
            }, { id: "test-script", email: "test@script", role: "admin" });

            const txn = result.transaction;
            const meta = txn.meta as any;

            console.log("✅ Operation Created. Transaction ID:", txn.id);
            console.log("   From Account:", meta.fromAccountId);
            console.log("   To Account:  ", meta.toAccountId);

            // 3. Verification
            let success = true;

            // Check FROM (Should be EXPENSE)
            if (meta.fromAccountId === ple.accounts?.expenseAccountId) {
                console.log("✅ Pass: Source is Expense Account");
            } else {
                console.error("❌ Fail: Source is NOT Expense Account. Got:", meta.fromAccountId);
                success = false;
            }

            // Check TO (Should be PAYIN)
            if (meta.toAccountId === ple.accounts?.payinAccountId) {
                console.log("✅ Pass: Destination is Payin Account");
            } else {
                console.error("❌ Fail: Destination is NOT Payin Account. Got:", meta.toAccountId);
                success = false;
            }

            if (success) {
                console.log("🎉 Verification PASSED: Logic is Reversed Successfully.");
                process.exit(0);
            } else {
                console.error("🔥 Verification FAILED.");
                process.exit(1);
            }

        } catch (e: any) {
            console.error("❌ Error executing operation:", e.message);
            process.exit(1);
        }

    } catch (e) {
        console.error("❌ Unexpected Error:", e);
        process.exit(1);
    }
}

verifyReversal();
