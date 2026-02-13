import { mongoose } from "./src/infra/mongoose-instance";
import { LedgerService } from "./src/services/ledger/ledger.service";
import { ProviderFeeSettlementService } from "./src/services/provider-fee-settlement/provider-fee-settlement.service";
import { ProviderLegalEntityModel } from "./src/models/provider-legal-entity.model";
import { ENV } from "./src/config/env";
import { getISTDate } from "./src/utils/date.util";

async function runManualSettlement() {
    try {
        console.log("🚀 Initializing connections...");

        // 1. Connect MongoDB
        await mongoose.connect(ENV.MONGODB_URI);
        console.log("✅ MongoDB connected");

        // 2. Connect Ledger (Postgres)
        await LedgerService.init({
            host: ENV.POSTGRES_HOST,
            port: parseInt(ENV.POSTGRES_PORT as string, 10),
            user: ENV.POSTGRES_USER,
            password: ENV.POSTGRES_PASSWORD,
            database: ENV.POSTGRES_DB,
            max: 10
        });
        console.log("✅ Ledger Service initialized");

        // 3. Determine Date (Using fixed logic)
        const nowIst = getISTDate();
        const yesterday = new Date(nowIst);
        yesterday.setDate(yesterday.getDate() - 1);
        const targetDate = yesterday.toISOString().split('T')[0];

        console.log(`\n📅 Target Settlement Date (IST "Yesterday"): ${targetDate}`);
        console.log(`(Calculated from Now IST: ${nowIst.toISOString()})\n`);

        // 4. Fetch all PLEs
        const ples = await ProviderLegalEntityModel.find({});
        console.log(`Found ${ples.length} Provider Legal Entities.`);

        // 5. Execute Settlement Direct
        for (const ple of ples) {
            console.log(`\n---------------------------------------------------`);
            console.log(`Processing ${ple.name} (${ple.id})...`);
            try {
                await ProviderFeeSettlementService.processPLESettlement(ple.id, targetDate);
                console.log(`✅ Success: ${ple.id}`);
            } catch (err: any) {
                console.error(`❌ Failed: ${ple.id}`, err.message);
            }
        }

        console.log(`\n---------------------------------------------------`);
        console.log("🏁 Manual Settlement Run Complete.");
        process.exit(0);

    } catch (error) {
        console.error("🔥 Fatal Error:", error);
        process.exit(1);
    }
}

runManualSettlement();
