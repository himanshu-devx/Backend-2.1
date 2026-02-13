import { mongoose } from "./src/infra/mongoose-instance";
import { ProviderModel } from "./src/models/provider.model";
import { LegalEntityModel } from "./src/models/legal-entity.model";
import { ProviderLegalEntityService } from "./src/services/provider/provider-legal-entity.service";
import { LedgerService } from "./src/services/ledger/ledger.service";
import { ENV } from "./src/config/env";

async function recreateLinks() {
    try {
        console.log("🚀 Recreating 3 Specific PLE Links (Natural Casing)...");

        // 1. Connect
        await mongoose.connect(ENV.MONGODB_URI);
        await LedgerService.init({
            host: ENV.POSTGRES_HOST,
            port: parseInt(ENV.POSTGRES_PORT as string, 10),
            user: ENV.POSTGRES_USER,
            password: ENV.POSTGRES_PASSWORD,
            database: ENV.POSTGRES_DB,
            max: 10
        });

        // 2. Resolve Entities
        // Helper to find by regex name
        const findProvider = async (p: string) => ProviderModel.findOne({ name: { $regex: p, $options: 'i' } });
        const findLE = async (p: string) => LegalEntityModel.findOne({ name: { $regex: p, $options: 'i' } });

        const pEase = await findProvider("Ease My Needs");
        const pSabio = await findProvider("Sabio Pay");

        const leCode = await findLE("Code Savants");
        const leAltalic = await findLE("Altalic Trade");

        if (!pEase || !pSabio || !leCode || !leAltalic) {
            console.error("❌ Could not find all entities!");
            console.log("Ease found?", !!pEase);
            console.log("Sabio found?", !!pSabio);
            console.log("Code found?", !!leCode);
            console.log("Altalic found?", !!leAltalic);

            console.log("\n--- Debug: Listing All Providers ---");
            const allP = await ProviderModel.find({});
            allP.forEach(p => console.log(`'${p.name}' (ID: ${p.id})`));

            console.log("\n--- Debug: Listing All Legal Entities ---");
            const allL = await LegalEntityModel.find({});
            allL.forEach(l => console.log(`'${l.name}' (ID: ${l.id})`));

            process.exit(1);
        }

        console.log(`\nFound Entities:`);
        console.log(`- Ease: ${pEase.id} (${pEase.name})`);
        console.log(`- Sabio: ${pSabio.id} (${pSabio.name})`);
        console.log(`- Code: ${leCode.id} (${leCode.name})`);
        console.log(`- Altalic: ${leAltalic.id} (${leAltalic.name})`);

        // 3. Create Links
        console.log("\nCreating Links...");

        // Link 1: Ease x Code
        try {
            await ProviderLegalEntityService.create(pEase.id, leCode.id, "MANUAL-RESTORE");
            console.log(`✅ Created: ${pEase.id}_${leCode.id}`);
        } catch (e: any) { console.log(`⚠️  Ease x Code: ${e.message}`); }

        // Link 2: Ease x Altalic
        try {
            await ProviderLegalEntityService.create(pEase.id, leAltalic.id, "MANUAL-RESTORE");
            console.log(`✅ Created: ${pEase.id}_${leAltalic.id}`);
        } catch (e: any) { console.log(`⚠️  Ease x Altalic: ${e.message}`); }

        // Link 3: Sabio x Altalic
        try {
            await ProviderLegalEntityService.create(pSabio.id, leAltalic.id, "MANUAL-RESTORE");
            console.log(`✅ Created: ${pSabio.id}_${leAltalic.id}`);
        } catch (e: any) { console.log(`⚠️  Sabio x Altalic: ${e.message}`); }

        console.log("\n🏁 Done.");
        process.exit(0);

    } catch (error) {
        console.error("🔥 Fatal Error:", error);
        process.exit(1);
    }
}

recreateLinks();
