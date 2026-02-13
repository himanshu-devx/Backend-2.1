import { mongoose } from "./src/infra/mongoose-instance";
import { ProviderModel } from "./src/models/provider.model";
import { LegalEntityModel } from "./src/models/legal-entity.model";
import { ENV } from "./src/config/env";

async function checkCasing() {
    try {
        await mongoose.connect(ENV.MONGODB_URI);

        const providers = await ProviderModel.find({}).limit(5);
        const les = await LegalEntityModel.find({}).limit(5);

        console.log("--- Providers ---");
        providers.forEach(p => console.log(`ID: '${p.id}' (Name: ${p.name})`));

        console.log("\n--- Legal Entities ---");
        les.forEach(l => console.log(`ID: '${l.id}' (Name: ${l.name})`));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkCasing();
