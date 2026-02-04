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
      // Check for unique name as well
      const existingName = await legalEntityRepository.findOne({
        name: data.name,
      });
      if (existingName) {
        return err(BadRequest("Legal Entity with this name already exists"));
      }

      // Generate ID for Legal Entity explicitly to avoid Mongoose validation race conditions
      if (!data.id && data.name) {
        const { generateSlug } = await import("@/utils/id.util");
        data.id = generateSlug(data.name);
      }

      // --- AUTOMATED PROVISIONING ---
      try {
        const { AccountManagerService } = await import(
          "@/services/ledger/account-manager.service"
        );
        const provisionResult =
          await AccountManagerService.provisionLegalEntityAccount(data.id!);
        if (!provisionResult.ok) throw provisionResult.error;
      } catch (error: any) {
        return err(
          BadRequest(
            `Failed to provision TigerBeetle account: ${error.message || "Unknown error"
            }`
          )
        );
      }

      // Assign provisioned data
      data.isOnboard = true;

      const created = await legalEntityRepository.create(data);

      if (auditContext) {
        AuditService.record({
          action: "LEGAL_ENTITY_CREATE",
          actorType: "ADMIN",
          actorId: auditContext.actorEmail,
          entityType: "LEGAL_ENTITY",
          entityId: created._id as unknown as string,
          metadata: { initialData: data },
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
        const ids = result.data.map(le => le.id);
        const { AccountManagerService } = await import("@/services/ledger/account-manager.service");
        const accountMap = await AccountManagerService.getAccountsForOwners(ids, "LEGAL_ENTITY");

        // We need to attach this to the results.
        // result.data are Mongoose documents. To attach arbitrary fields, we might need to rely on .toJSON() or lean() if repo returned lean.
        // BaseRepository often returns documents.
        // Let's try to set it dynamically. If strict TS checks fail on Document type, we might need `any`.
        result.data = result.data.map((doc) => {
          const json = doc.toObject ? doc.toObject() : doc; // Ensure POJO
          const accounts = accountMap.get(json.id);
          if (accounts && accounts.main) {
            (json as any).mainAccount = accounts.main;
          } else {
            (json as any).mainAccount = null;
          }
          // Return simplified object with mainAccount
          return {
            id: json.id,
            name: json.name,
            displayName: json.displayName,
            identifier: json.identifier,
            entityType: json.entityType,
            status: json.status,
            createdAt: json.createdAt,
            mainAccount: (json as any).mainAccount // Include the enriched mainAccount
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

    try {
      const { AccountManagerService } = await import("@/services/ledger/account-manager.service");
      const accountMap = await AccountManagerService.getAccountsForOwners([id], "LEGAL_ENTITY");
      const accounts = accountMap.get(id);

      if (accounts && accounts.main) {
        (leObj as any).mainAccount = accounts.main;
      } else {
        (leObj as any).mainAccount = null;
      }
    } catch (e) {
      console.error("Failed to enrich LE details:", e);
    }

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

  static async onboard(
    id: string
  ): Promise<Result<LegalEntityDocument, HttpError>> {
    const le = await legalEntityRepository.findOne({ id: id });
    if (!le) return err(NotFound("Legal Entity not found"));

    try {
      const { AccountManagerService } = await import(
        "@/services/ledger/account-manager.service"
      );
      const result = await AccountManagerService.provisionLegalEntityAccount(
        id
      );
      if (!result.ok) throw result.error;

      le.isOnboard = true;
      await le.save();

      return ok(le);
    } catch (e: any) {
      return err(
        BadRequest(
          `Failed to provision accounts: ${e.message || "Unknown error"}`
        )
      );
    }
  }
}
