import { mongoose } from "./src/infra/mongoose-instance";
import { ProviderLegalEntityModel } from "./src/models/provider-legal-entity.model";
import { ProviderModel } from "./src/models/provider.model";
import { LegalEntityModel } from "./src/models/legal-entity.model";
import { TransactionModel } from "./src/models/transaction.model";
import { ProviderLegalEntityService } from "./src/services/provider/provider-legal-entity.service";
import { LedgerService } from "./src/services/ledger/ledger.service";
import { ENV } from "./src/config/env";

async function recreateAndMigrate() {
    try {
        console.log("🚀 Starting Comprehensive Migration (Natural Casing)...");

        // 1. Initialize Connections
        await mongoose.connect(ENV.MONGODB_URI);
        await LedgerService.init({
            host: ENV.POSTGRES_HOST,
            port: parseInt(ENV.POSTGRES_PORT as string, 10),
            user: ENV.POSTGRES_USER,
            password: ENV.POSTGRES_PASSWORD,
            database: ENV.POSTGRES_DB,
            max: 10
        });

        // 2. Wipe existing PLEs
        console.log("🗑️ Wiping all Provider Legal Entities...");
        await ProviderLegalEntityModel.deleteMany({});
        console.log("✅ Wiped.");

        // 3. Recreate PLEs (All Combinations) with Natural Casing
        // The Service logic has been updated to use Natural Casing.
        const providers = await ProviderModel.find({ status: "ACTIVE" });
        const legalEntities = await LegalEntityModel.find({ status: "ACTIVE" });

        console.log(`found ${providers.length} Providers and ${legalEntities.length} Legal Entities.`);
        console.log("Creation Strategy: Natural Casing (e.g. EaseMyNeeds_CodeSavants)");

        let createdCount = 0;
        for (const p of providers) {
            for (const le of legalEntities) {
                try {
                    // Service will generate ID: p.id + "_" + le.id (Last update removed .toUpperCase())
                    await ProviderLegalEntityService.create(p.id, le.id, "SYSTEM-MIGRATION");
                    createdCount++;
                } catch (err: any) {
                    console.error(`Failed to create ${p.id} x ${le.id}:`, err.message);
                }
            }
        }
        console.log(`✅ Recreated ${createdCount} PLEs.`);

        // 4. Delete Zero-Fee Settlements (Today/Recent)
        console.log("🗑️ Cleaning up bad zero-fee settlements...");
        const delRes = await TransactionModel.deleteMany({
            type: { $in: ["PLE_PAYIN_FEE_CHARGE", "PLE_PAYOUT_FEE_CHARGE"] },
            "fees.providerFees.total": 0
        });
        console.log(`Deleted ${delRes.deletedCount} incorrect settlement records.`);

        // 5. Migrate Transactions to Natural Casing IDs
        console.log("🔄 Migrating Historical Transactions...");
        const txns = await TransactionModel.find({
            type: { $in: ["PAYIN", "PAYOUT"] },
            providerId: { $exists: true },
            legalEntityId: { $exists: true }
        });

        const bulkOps = [];
        for (const t of txns) {
            // Natural Casing construction
            const naturalPleId = `${t.providerId}_${t.legalEntityId}`; // NO .toUpperCase()

            if (t.providerLegalEntityId !== naturalPleId) {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: t._id },
                        update: { $set: { providerLegalEntityId: naturalPleId } }
                    }
                });
            }
        }

        if (bulkOps.length > 0) {
            console.log(`Executing ${bulkOps.length} transaction updates...`);
            await TransactionModel.bulkWrite(bulkOps);
        }
        console.log("✅ Transaction Migration Complete.");

        console.log("\n🎉 All Done! You can now run 'manual-settlement-run.ts' to verify.");
        process.exit(0);

    } catch (error) {
        console.error("🔥 Fatal Error:", error);
        process.exit(1);
    }
}

recreateAndMigrate();
