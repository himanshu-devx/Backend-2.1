import {
  LegalEntityDocument,
  LegalEntityModel,
} from "@/models/legal-entity.model";
import { BaseRepository, PaginatedResult } from "@/utils/base-repository";
import { ok, err, Result } from "@/utils/result";
import {
  HttpError,
  NotFound,
  BadRequest,
  Conflict,
  InternalError,
} from "@/utils/error";
import { AuditContext } from "@/utils/audit.util";
import { AuditService } from "@/services/common/audit.service";

class LegalEntityRepository extends BaseRepository<LegalEntityDocument> {
  constructor() {
    super(LegalEntityModel);
  }
}

export const legalEntityRepository = new LegalEntityRepository();

export class LegalEntityService {
  static async create(
    data: Partial<LegalEntityDocument>,
    auditContext?: AuditContext
  ): Promise<Result<LegalEntityDocument, HttpError>> {
    try {
      const existing = await legalEntityRepository.findOne({
        identifier: data.identifier,
      });
      if (existing) {
        return err(
          Conflict("Legal Entity with this identifier already exists")
        );
      }

      if (!data.id && data.name) {
        data.id = data.name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]/g, "");
      }

      if (!data.id) {
        return err(BadRequest("Leagl Entity with this name have issue"));
      }

      // Check for unique name as well
      const existingName = await legalEntityRepository.findOne({ id: data.id });
      if (existingName) {
        return err(BadRequest("Legal Entity with this name already exists"));
      }

      // --- AUTOMATED PROVISIONING ---
      let createdAccount: any = null;
      try {
        const { AccountService } = await import("@/services/ledger/account.service");
        createdAccount = await AccountService.createLegalEntityAccount(
          data.id!,
          data.name!,
          auditContext?.actorEmail || "SYSTEM"
        );

        // Verify account was created
        if (!createdAccount || !createdAccount.id) {
          throw new Error("Failed to create ledger account for legal entity");
        }
      } catch (error: any) {
        console.error("[ERROR] Failed to provision ledger account for legal entity:", error);
        return err(
          BadRequest(
            `Failed to provision ledger account: ${error.message || "Unknown error"}`
          )
        );
      }

      // Assign provisioned data
      data.isOnboard = true;

      // Store ledger account ID in legal entity model
      (data as any).accounts = {
        bankAccountId: createdAccount.id,
      };

      const created = await legalEntityRepository.create(data);

      if (auditContext) {
        AuditService.record({
          action: "LEGAL_ENTITY_CREATE",
          actorType: "ADMIN",
          actorId: auditContext.actorEmail,
          entityType: "LEGAL_ENTITY",
          entityId: created._id as unknown as string,
          metadata: {
            initialData: data,
            ledgerAccountId: createdAccount?.id
          },
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          requestId: auditContext.requestId,
        });
      }

      return ok(created);
    } catch (e: any) {
      console.error("LEGAL_ENTITY_CREATE_ERROR:", e);
      // Use InternalError helper which returns AppError
      return err(
        InternalError(e.message || "Internal Server Error", { stack: e.stack })
      );
    }
  }

  static async list(
    query: any
  ): Promise<Result<PaginatedResult<LegalEntityDocument>, HttpError>> {
    const { page, limit, search, sort, ...filter } = query;
    const result = await legalEntityRepository.list({
      filter,
      page,
      limit,
      search,
      sort,
      searchFields: ["name", "identifier"], // Assuming name and identifier are searchable
    });

    if (result.data.length > 0) {
      try {
        const { AccountService } = await import("@/services/ledger/account.service");

        // Collect all account IDs
        const allAccountIds: string[] = [];
        result.data.forEach((doc: any) => {
          const json = doc.toObject ? doc.toObject() : doc;
          if (json.accounts?.bankAccountId) {
            allAccountIds.push(json.accounts.bankAccountId);
          }
        });

        // Fetch all balances
        const balances = await AccountService.getAccountBalances(allAccountIds);

        // Map to simplified objects with balances
        result.data = result.data.map((doc) => {
          const json = doc.toObject ? doc.toObject() : doc;
          return {
            id: json.id,
            name: json.name,
            displayName: json.displayName,
            identifier: json.identifier,
            entityType: json.entityType,
            status: json.status,
            createdAt: json.createdAt,
            bankAccount: json.accounts?.bankAccountId ? {
              accountId: json.accounts.bankAccountId,
              ledgerBalance: balances[json.accounts.bankAccountId] || '0'
            } : null
          };
        }) as any;
      } catch (err) {
        console.error("Failed to enrich LEs with balances:", err);
      }
    }

    return ok(result);
  }

  static async getById(
    id: string
  ): Promise<Result<LegalEntityDocument, HttpError>> {
    const le = await legalEntityRepository.findOne({ id: id });
    if (!le) return err(NotFound("Legal Entity not found"));

    const leObj = le.toObject ? le.toObject() : (le as any);

    return ok(leObj);
  }

  static async update(
    id: string,
    data: Partial<LegalEntityDocument> | any,
    auditContext?: AuditContext
  ): Promise<Result<LegalEntityDocument, HttpError>> {
    const le = await legalEntityRepository.findOne({ id: id });
    if (!le) return err(NotFound("Legal Entity not found"));

    const previousValues = le.toObject();

    const updates: any = {};
    if (data.displayName) updates.displayName = data.displayName;
    if (data.identifier) updates.identifier = data.identifier;
    if (data.gstin !== undefined) updates.gstin = data.gstin;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    // Handle nested merge for bankAccount
    if (data.bankAccount) {
      // Ensure le.bankAccount is treated as an object if it exists, or empty object
      const existingBank = le.bankAccount || {};
      updates.bankAccount = { ...existingBank, ...data.bankAccount };
    }

    if (Object.keys(updates).length === 0) return ok(le);

    const updated = await legalEntityRepository.update(
      le._id as unknown as string,
      updates
    );

    if (!updated) return err(NotFound("Failed to update legal entity"));

    if (auditContext) {
      AuditService.record({
        action: "LEGAL_ENTITY_UPDATE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "LEGAL_ENTITY",
        entityId: id,
        metadata: { previousValues, newValues: updates },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(updated);
  }

}
