import { ProviderDocument, ProviderModel } from "@/models/provider.model";
import { BaseRepository, PaginatedResult } from "@/utils/base-repository";
import { ok, err, Result } from "@/utils/result";
import { HttpError, NotFound, BadRequest } from "@/utils/error";
import { AuditContext } from "@/utils/audit.util";
import { AuditService } from "@/services/common/audit.service";
import { CacheService } from "@/services/common/cache.service";

class ProviderRepository extends BaseRepository<ProviderDocument> {
  constructor() {
    super(ProviderModel);
  }
}

export const providerRepository = new ProviderRepository();

export class ProviderService {
  static async create(
    data: Partial<ProviderDocument>,
    auditContext?: AuditContext
  ): Promise<Result<ProviderDocument, HttpError>> {

    if (!data.id && data.name) {
      data.id = data.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, "");
    }

    if (!data.id) {
      return err(BadRequest("Provider with this name have issue"));
    }


    const existing = await providerRepository.findOne({ id: data.id });
    if (existing) {
      return err(BadRequest("Provider with this name already exists"));
    }

    // Generate ID explicitly


    const created = await providerRepository.create(data);

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_CREATE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER",
        entityId: created._id as unknown as string,
        metadata: { initialData: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(created);
  }

  static async list(
    query: any
  ): Promise<Result<PaginatedResult<ProviderDocument>, HttpError>> {
    const { page, limit, search, sort, ...filter } = query;
    const result = await providerRepository.list({
      filter,
      page,
      limit,
      search,
      sort,
      searchFields: ["name"], // Assuming name is searchable
    });
    return ok(result);
  }

  static async getById(
    id: string
  ): Promise<Result<ProviderDocument, HttpError>> {
    const provider = await providerRepository.findOne({ id: id });
    if (!provider) return err(NotFound("Provider not found"));
    return ok(provider);
  }

  static async update(
    id: string,
    data: any,
    auditContext?: AuditContext
  ): Promise<Result<ProviderDocument, HttpError>> {
    const provider = await providerRepository.findOne({ id: id });
    if (!provider) return err(NotFound("Provider not found"));

    const previousValues = provider.toObject();

    // Prepare updates
    const updates: any = {};
    if (data.displayName) updates.displayName = data.displayName;
    if (data.type) updates.type = data.type;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    // Handle nested merge for capabilities
    if (data.capabilities) {
      updates.capabilities = {
        ...provider.capabilities,
        ...data.capabilities,
      };
    }

    if (Object.keys(updates).length === 0) {
      return ok(provider);
    }

    const updated = await providerRepository.update(
      provider._id as unknown as string,
      updates
    );

    if (!updated) return err(NotFound("Failed to update provider"));

    if (auditContext) {
      AuditService.record({
        action: "PROVIDER_UPDATE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "PROVIDER",
        entityId: id,
        metadata: { previousValues, newValues: updates },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    if (updates.type) {
      await CacheService.invalidateProviderType(id);
    }

    return ok(updated);
  }
}
