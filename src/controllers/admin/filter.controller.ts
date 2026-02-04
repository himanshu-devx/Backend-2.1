import { Context } from "hono";
import { respond } from "@/utils/result-http";
import { ok } from "@/utils/result";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderModel } from "@/models/provider.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import {
    TransactionType,
    TransactionEntityType,
} from "@/constants/transaction.constant";
import { TransactionStatus } from "@/models/transaction.model";

export class FilterController {
    static async getFilters(c: Context) {
        const [merchants, providers, les] = await Promise.all([
            MerchantModel.find({}, { id: 1, name: 1, displayName: 1 }).lean(),
            ProviderModel.find({}, { id: 1, name: 1 }).lean(),
            LegalEntityModel.find({}, { id: 1, name: 1 }).lean(),
        ]);

        // Format for frontend (optional, but raw is fine too)
        // We send raw list and let frontend map it.

        const transactionTypes = Object.values(TransactionType).map((t) => ({
            id: t,
            name: t,
        }));
        const transactionStatuses = Object.values(TransactionStatus).map((s) => ({
            id: s,
            name: s,
        }));
        const entityTypes = Object.values(TransactionEntityType).map((e) => ({
            id: e,
            name: e,
        }));

        return respond(
            c,
            ok({
                merchants: merchants.map((m) => ({
                    id: m.id,
                    name: m.displayName || m.name, // Prefer display name
                    originalName: m.name,
                })),
                providers: providers.map((m) => ({
                    id: m.id,
                    name: m.name,
                })),
                legalEntities: les.map((m) => ({
                    id: m.id,
                    name: m.name,
                })),
                transactionTypes,
                transactionStatuses,
                entityTypes,
            })
        );
    }
}
