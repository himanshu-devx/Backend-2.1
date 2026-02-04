import { Context } from "hono";
import { TRANSFER_OPERATIONS } from "@/constants/transfer-operation.constant";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { LedgerAccountModel } from "@/models/ledger-account.model";
import { BadRequest } from "@/utils/error";

export class TransferOperationController {

    /**
     * Get all available transfer operations
     */
    async listOperations(c: Context) {
        const ownerType = c.req.query("ownerType");

        let operations = TRANSFER_OPERATIONS;

        if (ownerType) {
            operations = Object.fromEntries(
                Object.entries(TRANSFER_OPERATIONS).filter(([key, op]) => op.entityType === ownerType)
            ) as any;
        }

        return c.json({
            success: true,
            data: operations
        });
    }

    /**
     * Get entities and auto-selected accounts for a specific operation
     */
    /**
     * Get entities and auto-selected accounts for a specific operation
     */
    async getOperationEntities(c: Context) {
        const type = c.req.param("type");
        const search = c.req.query("search")?.toLowerCase();

        const operation = TRANSFER_OPERATIONS[type];
        if (!operation) {
            throw BadRequest("Invalid Operation Type");
        }

        const { entities, accounts } = await this.resolveEntitiesAndAccounts(operation.entityType, search);

        // Constants for World ID
        const { AccountManagerService } = await import("@/services/ledger/account-manager.service");
        const worldId = await AccountManagerService.getWorldAccountId();

        const includesWorldSource = operation.sources.includes("WORLD");
        const includesWorldDest = operation.destinations.includes("WORLD");

        // Structure Result using operation-specific mappings
        const resultEntities = entities.map(entity => {
            const myAccounts = accounts.filter(a => a.ownerId === entity.id);

            const sourceAccounts: Record<string, string | null> = {};
            if (includesWorldSource) sourceAccounts["WORLD"] = worldId;

            operation.sources.forEach(slug => {
                if (slug === "WORLD") return;
                const acc = myAccounts.find(a => a.typeSlug === slug);
                sourceAccounts[slug] = acc ? acc.accountId : null;
            });

            const destAccounts: Record<string, string | null> = {};
            if (includesWorldDest) destAccounts["WORLD"] = worldId;

            operation.destinations.forEach(slug => {
                if (slug === "WORLD") return;
                const acc = myAccounts.find(a => a.typeSlug === slug);
                destAccounts[slug] = acc ? acc.accountId : null;
            });

            return {
                ...entity,
                sourceAccounts,
                destAccounts,
                sources: Object.keys(sourceAccounts),
                destinations: Object.keys(destAccounts)
            };
        });

        return c.json({
            success: true,
            data: {
                operation,
                entities: resultEntities
            }
        });
    }

    /**
     * Get all available transfer operations for a specific entity
     * GET /available-for-entity?ownerId=...&ownerType=...
     */
    async getOperationsForEntity(c: Context) {
        const ownerType = c.req.query("ownerType");
        const ownerId = c.req.query("ownerId");
        const search = c.req.query("search")?.toLowerCase();

        if (!ownerType) {
            throw BadRequest("ownerType is required");
        }

        // 1. Resolve Entities and their Accounts
        const { entities, accounts } = await this.resolveEntitiesAndAccounts(ownerType as any, search, ownerId);

        // 2. Constants for World ID
        const { AccountManagerService } = await import("@/services/ledger/account-manager.service");
        const worldId = await AccountManagerService.getWorldAccountId();

        // 3. Map Operations for each Entity
        const result = entities.map(entity => {
            // Include entity-specific accounts AND global system accounts
            const relevantAccounts = accounts.filter(a =>
                a.ownerId === entity.id ||
                a.ownerType === "SUPER_ADMIN" ||
                a.ownerType === "LEGAL_ENTITY"
            );

            const operations = Object.entries(TRANSFER_OPERATIONS)
                .filter(([_, op]) => op.entityType === ownerType)
                .map(([type, op]) => {
                    const sourceAccounts: Record<string, string | null> = {};
                    const destAccounts: Record<string, string | null> = {};

                    // Map Sources
                    op.sources.forEach(slug => {
                        if (slug === "WORLD") {
                            sourceAccounts["WORLD"] = worldId;
                        } else {
                            const acc = relevantAccounts.find(a => a.typeSlug === slug);
                            sourceAccounts[slug] = acc ? acc.accountId : null;
                        }
                    });

                    // Map Destinations
                    op.destinations.forEach(slug => {
                        if (slug === "WORLD") {
                            destAccounts["WORLD"] = worldId;
                        } else {
                            const acc = relevantAccounts.find(a => a.typeSlug === slug);
                            destAccounts[slug] = acc ? acc.accountId : null;
                        }
                    });

                    return {
                        type,
                        label: op.label,
                        description: op.description,
                        group: op.group,
                        recommendedFields: op.recommendedFields,
                        sourceAccounts,
                        destAccounts,
                        sources: Object.keys(sourceAccounts),
                        destinations: Object.keys(destAccounts)
                    };
                });

            return {
                ...entity,
                operations
            };
        });

        return c.json({
            success: true,
            data: result
        });
    }

    /**
     * Shared helper to resolve entities and their accounts
     */
    private async resolveEntitiesAndAccounts(entityType: string, search?: string, ownerId?: string) {
        const { MerchantModel } = await import("@/models/merchant.model");
        const { ProviderLegalEntityModel } = await import("@/models/provider-legal-entity.model");
        const { LegalEntityModel } = await import("@/models/legal-entity.model");
        const { LedgerAccountModel } = await import("@/models/ledger-account.model");

        let entities: any[] = [];

        const filterEntities = (list: any[]) => {
            if (!search) return list;
            return list.filter(e =>
                (e.id && e.id.toLowerCase().includes(search)) ||
                (e.name && e.name.toLowerCase().includes(search)) ||
                (e.email && e.email.toLowerCase().includes(search)) ||
                (e.identifier && e.identifier.toLowerCase().includes(search))
            );
        };

        const query: any = {};
        if (ownerId) query.id = ownerId;

        if (entityType === "MERCHANT") {
            const merchants = await MerchantModel.find(query).lean();
            entities = filterEntities(merchants).map(m => ({
                id: m.id,
                name: m.name,
                email: m.email,
                type: "MERCHANT"
            }));
        } else if (entityType === "PROVIDER") {
            const ples = await ProviderLegalEntityModel.find(query).lean();
            entities = filterEntities(ples).map(ple => ({
                id: ple.id,
                name: ple.name || `PLE-${ple.id}`,
                type: "PROVIDER"
            }));
        } else if (entityType === "LEGAL_ENTITY") {
            const les = await LegalEntityModel.find(query).lean();
            entities = filterEntities(les).map(le => ({
                id: le.id,
                name: le.name,
                identifier: le.identifier,
                type: "LEGAL_ENTITY"
            }));
        } else if (entityType === "INCOME" || (ownerId === "SYSTEM")) {
            entities = [{ id: "SYSTEM", name: "System Income", type: "INCOME" }];
        }

        const ownerIds = entities.map(e => e.id);
        const accounts = await LedgerAccountModel.find({
            $or: [
                { ownerId: { $in: ownerIds } },
                { ownerType: { $in: ["SUPER_ADMIN", "LEGAL_ENTITY"] } }
            ],
            isActive: { $ne: false }
        }).lean();

        return { entities, accounts };
    }

    /**
     * Execute a transfer operation
     */
    async executeOperation(c: Context) {
        const body = await c.req.json();
        let { operationType, sourceAccountId, destAccountId, amount, description, sourceEntityId, sourceAccountSlug, destEntityId, destAccountSlug, customFields, isBackDated, backDate } = body;

        // 1. Validate Input
        if (!operationType || !amount) {
            throw BadRequest("Missing required fields: operationType, amount");
        }

        const operation = TRANSFER_OPERATIONS[operationType];
        if (!operation) {
            throw BadRequest("Invalid Operation Type");
        }

        // Helper to resolve Account ID
        const resolveAccountId = async (accId: string | undefined, entityId: string | undefined, slug: string | undefined, label: string): Promise<string> => {
            if (accId) {
                if (accId === "WORLD") return AccountManagerService.getWorldAccountId();
                return accId;
            }
            if (entityId && slug) {
                if (entityId === "WORLD" || slug === "WORLD") return AccountManagerService.getWorldAccountId();

                // Lookup
                const account = await LedgerAccountModel.findOne({ ownerId: entityId, typeSlug: slug });
                if (!account) throw BadRequest(`${label}: Account not found for Entity ${entityId} and Slug ${slug}`);
                return account.accountId;
            }
            throw BadRequest(`${label}: Provide either accountId OR (entityId + accountSlug)`);
        };

        const { AccountManagerService } = await import("@/services/ledger/account-manager.service");
        // Resolve Source
        const finalSourceId = await resolveAccountId(sourceAccountId, sourceEntityId, sourceAccountSlug, "Source");
        // Resolve Dest
        const finalDestId = await resolveAccountId(destAccountId, destEntityId, destAccountSlug, "Destination");

        // 2. Fetch Accounts to Validate Types
        const accounts = await LedgerAccountModel.find({
            accountId: { $in: [finalSourceId, finalDestId] }
        });

        const sourceAccount = accounts.find(a => a.accountId === finalSourceId);
        const destAccount = accounts.find(a => a.accountId === finalDestId);

        if (!sourceAccount) throw BadRequest(`Source Account not found: ${finalSourceId}`);
        if (!destAccount) throw BadRequest(`Destination Account not found: ${finalDestId}`);

        // 3. Validate Source/Dest Compatibility
        const validSource = operation.sources.includes(sourceAccount.typeSlug) || (operation.sources.includes("WORLD") && sourceAccount.typeSlug === "WORLD:MAIN");
        const validDest = operation.destinations.includes(destAccount.typeSlug) || (operation.destinations.includes("WORLD") && destAccount.typeSlug === "WORLD:MAIN");

        if (!validSource) {
            throw BadRequest(`Source Account Type '${sourceAccount.typeSlug}' not allowed. Allowed: ${operation.sources.join(", ")}`);
        }

        if (!validDest) {
            throw BadRequest(`Destination Account Type '${destAccount.typeSlug}' not allowed. Allowed: ${operation.destinations.join(", ")}`);
        }

        // 4. Validate Amount
        const amountBi = BigInt(amount);
        if (amountBi <= 0n) throw BadRequest("Amount must be positive");

        // 5. Execute Transfer
        const { LedgerService } = await import("@/services/ledger/ledger.service");
        const { CURRENCY } = await import("@/constants/tigerbeetle.constant");
        const { TransactionModel, TransactionStatus } = await import("@/models/transaction.model");
        const { TransactionEntityType, TransactionPartyType, TransactionType } = await import("@/constants/transaction.constant");

        try {
            const transfer = await LedgerService.createTransfer(
                finalSourceId,
                finalDestId,
                amountBi,
                CURRENCY.INR, // Use constant
                {
                    reason: description || operation.label,
                    actorType: "ADMIN",
                    actorName: "Admin User", // TODO: Get from Auth Context
                    actorId: (c.get("jwtPayload") as any)?.sub || "admin",
                    meta: {
                        operationType,
                        customFields // Store extra fields (UTR, Bank Details, Ticket ID etc.)
                    },
                    isBackDated: !!isBackDated,
                    createdAt: backDate ? new Date(backDate) : undefined
                }
            );

            // 6. Create Transaction Record (Harmonized)
            // Resolve Entity IDs for the Transaction Record
            const sourceEntityIdRecord = sourceAccountId === "WORLD" || sourceEntityId === "WORLD" ? "WORLD" : (sourceEntityId || "UNKNOWN");
            const sourceEntityTypeRecord = sourceAccountId === "WORLD" || sourceEntityId === "WORLD" ? "WORLD" : (sourceAccount.ownerType || "UNKNOWN");

            const destEntityIdRecord = destAccountId === "WORLD" || destEntityId === "WORLD" ? "WORLD" : (destEntityId || "UNKNOWN");
            const destEntityTypeRecord = destAccountId === "WORLD" || destEntityId === "WORLD" ? "WORLD" : (destAccount.ownerType || "UNKNOWN");

            const txnDoc: any = {
                sourceEntityId: sourceEntityIdRecord,
                sourceEntityType: sourceEntityTypeRecord as any,
                destinationEntityId: destEntityIdRecord,
                destinationEntityType: destEntityTypeRecord as any,

                type: operationType as any,
                status: TransactionStatus.SUCCESS,
                amount: Number(amountBi),
                currency: "INR",

                providerRef: `OP-${transfer.id.toString()}`,
                description: description || operation.label,

                party: {
                    type: TransactionPartyType.SELF,
                    name: operation.label,
                    details: {
                        operationType,
                        customFields,
                        initiatorId: (c.get("jwtPayload") as any)?.sub || "admin"
                    }
                },

                paymentMode: "MANUAL",
                meta: {
                    operationType,
                    customFields,
                    transferId: transfer.id.toString()
                }
            };

            // Handle Backdating
            if (isBackDated && backDate) {
                const { getISTDate } = await import("@/utils/date.util");
                txnDoc.isBackDated = true;
                txnDoc.createdAt = new Date(backDate);
                txnDoc.insertedDate = getISTDate();
            }

            const txn = await TransactionModel.create(txnDoc);

            // Audit Log
            const { AuditService } = await import("@/services/common/audit.service");
            await AuditService.record({
                action: operationType,
                actorId: (c.get("jwtPayload") as any)?.sub || "admin",
                actorType: "ADMIN",
                entityType: "TRANSACTION",
                entityId: txn.id,
                metadata: {
                    operationType,
                    sourceAccountId: finalSourceId,
                    destAccountId: finalDestId,
                    amount: Number(amountBi),
                    orderId: txn.orderId,
                    customFields
                }
            });

            // Double check? LedgerService doesn't shift for us logic-wise unless we change it. 
            // We moved logic to LedgerService in previous step?
            // Let's check LedgerService.

            return c.json({
                success: true,
                data: {
                    transferId: transfer.id.toString(),
                    amount: transfer.amount.toString(),
                    status: "POSTED", // Immediate post
                    orderId: txn.orderId
                }
            });
        } catch (e: any) {
            throw BadRequest(e.message);
        }
    }
}
