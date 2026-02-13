import { mongoose } from "./src/infra/mongoose-instance";
import { TransactionModel } from "./src/models/transaction.model";
import { ENV } from "./src/config/env";
import { getISTDate, getISTDayStart, getISTDayEnd } from "./src/utils/date.util";

async function debugFees() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(ENV.MONGODB_URI);

        const pleId = "EASEMYNEEDS_CODESAVANTS";

        // 2. List all transactions for the date range to inspect PLE IDs.
        const nowIst = getISTDate();
        const yesterday = new Date(nowIst);
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];

        console.log(`\n--- Date Range Check for ${dateStr} (IST) ---`);
        const start = getISTDayStart(dateStr);
        const end = getISTDayEnd(dateStr);

        console.log(`Query Range (UTC): ${start.toISOString()} - ${end.toISOString()}`);

        const anyTxns = await TransactionModel.find({
            status: "SUCCESS",
            type: { $in: ["PAYIN", "PAYOUT"] },
            updatedAt: { $gte: start, $lte: end }
        }).select("id providerLegalEntityId fees type updatedAt").limit(10).lean();

        if (anyTxns.length === 0) {
            console.log("❌ No SUCCESS PAYIN/PAYOUT transactions found in this date range.");
        } else {
            console.log(`Found ${anyTxns.length} transactions. Inspecting Casing:`);
            anyTxns.forEach((t: any) => {
                console.log(`\nTxnID: ${t.id}`);
                console.log(`- Stored providerId: '${t.providerId}'`);
                console.log(`- Stored legalEntityId: '${t.legalEntityId}'`);
                console.log(`- Stored providerLegalEntityId: '${t.providerLegalEntityId}'`);
                console.log(`- Expected (Composite): '${t.providerId}_${t.legalEntityId}'`);
            });
        }

        console.log("\n--- Checking Actual PLEs in DB ---");
        const ples = await import("./src/models/provider-legal-entity.model").then(m => m.ProviderLegalEntityModel.find({}));
        ples.forEach(p => console.log(`PLE Document ID: '${p.id}'`));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugFees();
