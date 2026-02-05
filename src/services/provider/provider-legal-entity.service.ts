import {
  ProviderLegalEntityDocument,
  ProviderLegalEntityModel,
} from "@/models/provider-legal-entity.model";
import { FeeTier } from "@/models/shared/service-config.schema";
import { BaseRepository, PaginatedResult } from "@/utils/base-repository";
import { ok, err, Result } from "@/utils/result";
import { HttpError, NotFound, BadRequest } from "@/utils/error";
import { AuditContext } from "@/utils/audit.util";
import { AuditService } from "@/services/common/audit.service";

class ProviderLegalEntityRepository extends BaseRepository<ProviderLegalEntityDocument> {
  constructor() {
    super(ProviderLegalEntityModel);
  }

  async findAll(query: any): Promise<PaginatedResult<ProviderLegalEntityDocument>> {
    const { page = 1, limit = 10, search, sort, ...filter } = query;
    const skip = (page - 1) * limit;

    const pipeline: any[] = [];

    // 1. Match base filters first
    if (Object.keys(filter).length > 0) {
      pipeline.push({ $match: filter });
    }

    // 2. Lookup Provider
    pipeline.push({
      $lookup: {
        from: "providers",
        localField: "providerId",
        foreignField: "id",
        as: "provider",
      },
    });
    pipeline.push({
      $unwind: { path: "$provider", preserveNullAndEmptyArrays: true },
    });

    // 3. Lookup LegalEntity
    pipeline.push({
      $lookup: {
        from: "legalentities",
        localField: "legalEntityId",
        foreignField: "id",
        as: "legalEntity",
      },
    });
    pipeline.push({
      $unwind: { path: "$legalEntity", preserveNullAndEmptyArrays: true },
    });

    // 4. Search Filter
    if (search) {
      const searchRegex = new RegExp(search, "i");
      pipeline.push({
        $match: {
          $or: [
            { "provider.name": searchRegex },
            { "legalEntity.name": searchRegex },
            { providerId: searchRegex },
            { legalEntityId: searchRegex },
          ],
        },
      });
    }

    // 5. Facet for Pagination and Sorting
    pipeline.push({
      $facet: {
        data: [
          ...(sort ? [{ $sort: sort }] : [{ $sort: { createdAt: -1 } }]),
          { $skip: Number(skip) },
          { $limit: Number(limit) },
        ],
        meta: [{ $count: "total" }],
      },
    });

    const [result] = await this.model.aggregate(pipeline);

    const data = result.data;
    const total = result.meta[0]?.total || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
      },
    };
  }
}

export const providerLegalEntityRepository =
  new ProviderLegalEntityRepository();

export interface UpdateProviderConfigDTO {
  isActive?: boolean;
  tps?: number;
  dailyLimit?: number;
  fees?: FeeTier[];
}

export class ProviderLegalEntityService {
  static async list(
    query: any
  ): Promise<Result<PaginatedResult<ProviderLegalEntityDocument>, HttpError>> {
    const result = await providerLegalEntityRepository.findAll(query);

    if (result.data.length > 0) {
      const simplifiedData = result.data.map((doc: any) => {
        const ple = doc.toJSON ? doc.toJSON() : doc;

        const pName = ple.provider?.name || ple.provider?.displayName || ple.providerId;
        const lName = ple.legalEntity?.name || ple.legalEntity?.displayName || ple.legalEntityId;
        const formattedName = `ple- (${pName} - ${lName})`;

        return {
          id: ple.id,
          name: ple.name && !ple.name.includes("REF-P") ? ple.name : formattedName,
          providerId: ple.providerId,
          legalEntityId: ple.legalEntityId,
          status: ple.status,
          createdAt: ple.createdAt,
          provider: ple.provider,
          legalEntity: ple.legalEntity,
          isOnboard: ple.isOnboard,
          payinAccount: null,
          payoutAccount: null,
          expenseAccount: null,
        };
      });

      result.data = simplifiedData as any;
    }

    return ok(result);
  }

  static async getById(
    id: string
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    const ple = await providerLegalEntityRepository.findOne({ id: id });
    if (!ple) return err(NotFound("Provider Legal Entity not found"));

    const pleObj = ple.toObject ? ple.toObject() : (ple as any);

    pleObj.payinAccount = null;
    pleObj.payoutAccount = null;
    pleObj.expenseAccount = null;

    if (!pleObj.name) {
      const { ProviderModel } = await import("@/models/provider.model");
      const { LegalEntityModel } = await import("@/models/legal-entity.model");
      const [provider, le] = await Promise.all([
        ProviderModel.findOne({ id: pleObj.providerId }).select("name displayName"),
        LegalEntityModel.findOne({ id: pleObj.legalEntityId }).select("name displayName"),
      ]);
      const pName = provider?.name || provider?.displayName || pleObj.providerId;
      const lName = le?.name || le?.displayName || pleObj.legalEntityId;
      pleObj.name = `ple- (${pName} - ${lName})`;
    }

    return ok(pleObj);
  }

  static async updatePayinConfig(
    id: string,
    data: UpdateProviderConfigDTO,
    auditContext?: AuditContext
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    const ple = await providerLegalEntityRepository.findOne({ id: id });
    if (!ple) return err(NotFound("Provider Legal Entity not found"));

    const pleObj = ple.toObject();
    const previousValues = pleObj.payin;
    const updatedPayin = { ...previousValues, ...data };

    const updated = await providerLegalEntityRepository.update(
      ple._id as unknown as string,
      {
        payin: updatedPayin,
      }
    );

    if (!updated) return err(NotFound("Failed to update payin config"));

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_UPDATE_PAYIN_CONFIG",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: id,
        metadata: { previousValues, newValues: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    const { CacheService } = await import("@/services/common/cache.service");
    await CacheService.invalidateChannel(pleObj.providerId, pleObj.legalEntityId);

    return ok(updated);
  }

  static async updatePayoutConfig(
    id: string,
    data: UpdateProviderConfigDTO,
    auditContext?: AuditContext
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    const ple = await providerLegalEntityRepository.findOne({ id: id });
    if (!ple) return err(NotFound("Provider Legal Entity not found"));

    const pleObj = ple.toObject();
    const previousValues = pleObj.payout;
    const updatedPayout = { ...previousValues, ...data };

    const updated = await providerLegalEntityRepository.update(
      ple._id as unknown as string,
      {
        payout: updatedPayout,
      }
    );

    if (!updated) return err(NotFound("Failed to update payout config"));

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_UPDATE_PAYOUT_CONFIG",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: id,
        metadata: { previousValues, newValues: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    const { CacheService } = await import("@/services/common/cache.service");
    await CacheService.invalidateChannel(pleObj.providerId, pleObj.legalEntityId);

    return ok(updated);
  }
  static async create(
    data: Partial<ProviderLegalEntityDocument>,
    auditContext?: AuditContext
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    // Generate ID explicitly
    if (!data.id) {
      const { generateCustomId } = await import("@/utils/id.util");
      data.id = await generateCustomId("PLE", "provider_legal_entity");
    }

    data.isOnboard = true;

    // Populate name during creation
    if (!data.name) {
      const { ProviderModel } = await import("@/models/provider.model");
      const { LegalEntityModel } = await import("@/models/legal-entity.model");
      const [provider, le] = await Promise.all([
        ProviderModel.findOne({ id: data.providerId }).select("name displayName"),
        LegalEntityModel.findOne({ id: data.legalEntityId }).select("name displayName"),
      ]);
      const pName = provider?.name || provider?.displayName || data.providerId;
      const lName = le?.name || le?.displayName || data.legalEntityId;
      data.name = `ple- (${pName} - ${lName})`;
    }

    const created = await providerLegalEntityRepository.create(data);

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_CREATE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: created._id as unknown as string,
        metadata: { initialData: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(created);
  }

  // --- Fee Management (Payin) ---

  // --- Fee Management (Payin) ---

  static async addPayinFeeTier(
    id: string,
    tier: FeeTier,
    auditContext?: AuditContext
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    const ple = await providerLegalEntityRepository.findOne({ id: id });
    if (!ple) return err(NotFound("Provider Legal Entity not found"));

    const newFees = [...ple.payin.fees, tier].sort(
      (a, b) => a.fromAmount - b.fromAmount
    );

    const updated = await providerLegalEntityRepository.update(
      ple._id as unknown as string,
      {
        "payin.fees": newFees,
      } as any
    );

    if (!updated) return err(NotFound("Failed to add payin fee"));

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_ADD_PAYIN_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: id,
        metadata: { addedTier: tier },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    const { CacheService } = await import("@/services/common/cache.service");
    await CacheService.invalidateChannel(ple.providerId, ple.legalEntityId);

    return ok(updated);
  }

  static async deletePayinFeeTier(
    id: string,
    tierId: { fromAmount: number },
    auditContext?: AuditContext
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    const ple = await providerLegalEntityRepository.findOne({ id: id });
    if (!ple) return err(NotFound("Provider Legal Entity not found"));

    const newFees = ple.payin.fees.filter(
      (f) => f.fromAmount !== tierId.fromAmount
    );

    const updated = await providerLegalEntityRepository.update(
      ple._id as unknown as string,
      {
        "payin.fees": newFees,
      } as any
    );

    if (!updated) return err(NotFound("Failed to delete payin fee"));

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_DELETE_PAYIN_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: id,
        metadata: { deletedTier: tierId },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    const { CacheService } = await import("@/services/common/cache.service");
    await CacheService.invalidateChannel(ple.providerId, ple.legalEntityId);

    return ok(updated);
  }

  // --- Fee Management (Payout) ---

  static async addPayoutFeeTier(
    id: string,
    tier: FeeTier,
    auditContext?: AuditContext
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    const ple = await providerLegalEntityRepository.findOne({ id: id });
    if (!ple) return err(NotFound("Provider Legal Entity not found"));

    const newFees = [...ple.payout.fees, tier].sort(
      (a, b) => a.fromAmount - b.fromAmount
    );

    const updated = await providerLegalEntityRepository.update(
      ple._id as unknown as string,
      {
        "payout.fees": newFees,
      } as any
    );

    if (!updated) return err(NotFound("Failed to add payout fee"));

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_ADD_PAYOUT_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: id,
        metadata: { addedTier: tier },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    const { CacheService } = await import("@/services/common/cache.service");
    await CacheService.invalidateChannel(ple.providerId, ple.legalEntityId);

    return ok(updated);
  }

  static async deletePayoutFeeTier(
    id: string,
    tierId: { fromAmount: number },
    auditContext?: AuditContext
  ): Promise<Result<ProviderLegalEntityDocument, HttpError>> {
    const ple = await providerLegalEntityRepository.findOne({ id: id });
    if (!ple) return err(NotFound("Provider Legal Entity not found"));

    const newFees = ple.payout.fees.filter(
      (f) => f.fromAmount !== tierId.fromAmount
    );

    const updated = await providerLegalEntityRepository.update(
      ple._id as unknown as string,
      {
        "payout.fees": newFees,
      } as any
    );

    if (!updated) return err(NotFound("Failed to delete payout fee"));

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_DELETE_PAYOUT_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: id,
        metadata: { deletedTier: tierId },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    const { CacheService } = await import("@/services/common/cache.service");
    await CacheService.invalidateChannel(ple.providerId, ple.legalEntityId);

    return ok(updated);
  }
}
