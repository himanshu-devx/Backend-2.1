import { ok, err, Result } from "@/utils/result";
import { AppError, NotFound, BadRequest } from "@/utils/error";
import { getISTDate } from "@/utils/date.util";
import { ListQueryDTO } from "@/dto/common.dto";
import {
  UpdateMerchantProfileDTO,
  UpdateServiceConfigDTO,
} from "@/dto/merchant/merchant.dto";
import { merchantRepository } from "@/repositories/merchant.repository";
import { AuditService } from "../common/audit.service";
import { AuditContext } from "@/utils/audit.util";
import { ProviderModel } from "@/models/provider.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { MerchantDocument } from "@/models/merchant.model";
import crypto from "crypto";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { TransactionType } from "@/constants/transaction.constant";
import { encryptSecret } from "@/utils/secret.util";

export class MerchantManagementService {
  static async getMerchantList(
    queryOptions: ListQueryDTO & { status?: string }
  ): Promise<Result<any, AppError>> {
    const filter: any = {};
    if (queryOptions.status) {
      if (queryOptions.status === "ACTIVE") filter.status = true;
      else if (queryOptions.status === "INACTIVE") filter.status = false;
    }

    const listResult = await merchantRepository.list({
      ...queryOptions,
      filter,
      searchFields: ["name", "email"],
    });

    if (!listResult || !listResult.data) {
      throw new AppError("Failed to retrieve merchant list from repository.", {
        status: 500,
      });
    }

    const sanitizedData = listResult.data.map((merchant: any) => {
      const json = merchant.toJSON();
      // Return simplified overview object
      return {
        id: json.id,
        name: json.name,
        displayName: json.displayName,
        email: json.email,
        role: json.role,
        status: json.status, // Account Status
        isOnboard: json.isOnboard,
        createdAt: json.createdAt,
        _accounts: json.accounts, // Keep for internal use
        // payment configs (payin/payout) excluded from list view
      };
    });

    // Enrich with ledger account balances
    try {
      const { AccountService } = await import("@/services/ledger/account.service");

      // Collect all account IDs
      const allAccountIds: string[] = [];
      sanitizedData.forEach((merchant: any) => {
        if (merchant._accounts) {
          if (merchant._accounts.payinAccountId) allAccountIds.push(merchant._accounts.payinAccountId);
          if (merchant._accounts.payoutAccountId) allAccountIds.push(merchant._accounts.payoutAccountId);
          if (merchant._accounts.holdAccountId) allAccountIds.push(merchant._accounts.holdAccountId);
        }
      });

      // Fetch all balances in one call
      const balances = await AccountService.getAccountBalances(allAccountIds);

      // Attach balances to each merchant in the new format
      sanitizedData.forEach((merchant: any) => {
        if (merchant._accounts) {
          merchant.payinAccount = {
            accountId: merchant._accounts.payinAccountId || null,
            ledgerBalance: balances[merchant._accounts.payinAccountId] || '0',
          };
          merchant.payoutAccount = {
            accountId: merchant._accounts.payoutAccountId || null,
            ledgerBalance: balances[merchant._accounts.payoutAccountId] || '0',
          };
          merchant.holdAccount = {
            accountId: merchant._accounts.holdAccountId || null,
            ledgerBalance: balances[merchant._accounts.holdAccountId] || '0',
          };
        }
        // Remove internal field
        delete merchant._accounts;
      });
    } catch (error) {
      console.error("Failed to enrich merchants with balances:", error);
    }

    return ok({ data: sanitizedData, meta: listResult.meta });
  }

  static async getMerchantById(
    id: string
  ): Promise<Result<MerchantDocument, AppError>> {
    const { CacheService } = await import("../common/cache.service");
    const merchantData = await CacheService.getMerchant(id);

    if (merchantData) {
      return ok(merchantData as unknown as MerchantDocument);
    }

    const merchant = await merchantRepository.findById(id);
    if (!merchant) {
      return err(NotFound("Merchant not found"));
    }
    merchant.password = "-";

    // Cache it for next time
    await CacheService.setMerchant(id, merchant.toJSON());

    return ok(merchant);
  }

  static async updateIpWhitelist(
    targetId: string,
    data: {
      panelIpWhitelist?: string[];
      isPanelIpWhitelistEnabled?: boolean;
      payinIpWhitelist?: string[];
      isPayinIpWhitelistEnabled?: boolean;
      payoutIpWhitelist?: string[];
      isPayoutIpWhitelistEnabled?: boolean;
    },
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(targetId);
    if (!merchant) {
      return err(NotFound("Merchant account not found."));
    }

    // Capture previous values for audit
    const previousValues = {
      panelIpWhitelist: merchant.panelIpWhitelist,
      isPanelIpWhitelistEnabled: merchant.isPanelIpWhitelistEnabled,
      payinIpWhitelist: merchant.payin?.apiIpWhitelist,
      isPayinIpWhitelistEnabled: merchant.payin?.isApiIpWhitelistEnabled,
      payoutIpWhitelist: merchant.payout?.apiIpWhitelist,
      isPayoutIpWhitelistEnabled: merchant.payout?.isApiIpWhitelistEnabled,
    };

    // Prepare update object with only provided fields
    const updateData: any = {}; // Use any to allow nested paths
    if (data.panelIpWhitelist !== undefined)
      updateData.panelIpWhitelist = data.panelIpWhitelist;
    if (data.isPanelIpWhitelistEnabled !== undefined)
      updateData.isPanelIpWhitelistEnabled = data.isPanelIpWhitelistEnabled;
    if (data.payinIpWhitelist !== undefined)
      updateData["payin.apiIpWhitelist"] = data.payinIpWhitelist;
    if (data.isPayinIpWhitelistEnabled !== undefined)
      updateData["payin.isApiIpWhitelistEnabled"] =
        data.isPayinIpWhitelistEnabled;
    if (data.payoutIpWhitelist !== undefined)
      updateData["payout.apiIpWhitelist"] = data.payoutIpWhitelist;
    if (data.isPayoutIpWhitelistEnabled !== undefined)
      updateData["payout.isApiIpWhitelistEnabled"] =
        data.isPayoutIpWhitelistEnabled;

    const updatedMerchant = await merchantRepository.update(
      targetId,
      updateData
    );

    if (!updatedMerchant) {
      throw new AppError("Failed to update IP whitelist.", { status: 500 });
    }

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_IP_PANEL",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: targetId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: {
          previousValues,
          newValues: updateData,
        },
      });
    }

    updatedMerchant.password = "-";

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(targetId);

    return ok(updatedMerchant);
  }

  static async toggleMerchantStatus(
    merchantId: string,
    auditContext?: AuditContext
  ): Promise<Result<any, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) {
      return err(NotFound("Merchant account not found."));
    }

    if (merchant.status) {
      await merchant.disableMerchant();
    } else {
      await merchant.enableMerchant();
    }

    if (auditContext) {
      await AuditService.record({
        action: "MERCHANT_UPDATE_STATUS",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail, // Updated by Admin (Email)
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { status: merchant.status },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);

    return ok(merchant.toJSON());
  }

  static async updateProfile(
    merchantId: string,
    data: UpdateMerchantProfileDTO,
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const previousValues = {
      name: merchant.name,
      email: merchant.email,
      isOnboard: merchant.isOnboard,
    };

    const updatedMerchant = await merchantRepository.update(merchantId, data);
    if (!updatedMerchant) return err(NotFound("Failed to update profile"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_PROFILE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { previousValues, newValues: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }
    updatedMerchant.password = "-";

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);

    return ok(updatedMerchant);
  }

  static async updatePayinConfig(
    merchantId: string,
    data: UpdateServiceConfigDTO,
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const previousValues = merchant.payin;

    const currentConfig = merchant.payin
      ? (merchant.payin as any).toObject()
      : {};
    const updatedPayin = { ...currentConfig, ...data };

    const updatedMerchant = await merchantRepository.update(merchantId, {
      payin: updatedPayin,
    });

    if (!updatedMerchant) {
      return err(NotFound("Failed to update payin config"));
    }

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_PAYIN_CONFIG",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { previousValues, newValues: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);

    return ok(updatedMerchant);
  }

  static async updatePayoutConfig(
    merchantId: string,
    data: UpdateServiceConfigDTO,
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const previousValues = merchant.payout;

    const currentConfig = merchant.payout
      ? (merchant.payout as any).toObject()
      : {};
    const updatedPayout = { ...currentConfig, ...data };

    const updatedMerchant = await merchantRepository.update(merchantId, {
      payout: updatedPayout,
    });

    if (!updatedMerchant) {
      return err(NotFound("Failed to update payout config"));
    }

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_PAYOUT_CONFIG",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { previousValues, newValues: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);

    return ok(updatedMerchant);
  }

  static async addPayinFeeTier(
    merchantId: string,
    tier: { fromAmount: number; toAmount: number; charge: any },
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    // Check for overlapping range
    const hasOverlap = merchant.payin.fees.some(
      (f) => f.fromAmount < tier.toAmount && tier.fromAmount < f.toAmount
    );

    if (hasOverlap) {
      return err(BadRequest("Duplicate or overlapping fee range"));
    }

    const newFees = [...merchant.payin.fees, tier].sort(
      (a, b) => a.fromAmount - b.fromAmount
    );

    const updatedMerchant = await merchantRepository.update(merchantId, {
      "payin.fees": newFees,
    } as any);

    if (!updatedMerchant) return err(NotFound("Failed to add payin fee"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_ADD_PAYIN_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { addedTier: tier },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);
    return ok(updatedMerchant);
  }

  static async deletePayinFeeTier(
    merchantId: string,
    tierId: { fromAmount: number },
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const newFees = merchant.payin.fees.filter(
      (f) => f.fromAmount !== tierId.fromAmount
    );

    const updatedMerchant = await merchantRepository.update(merchantId, {
      "payin.fees": newFees,
    } as any);

    if (!updatedMerchant) return err(NotFound("Failed to delete payin fee"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_DELETE_PAYIN_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { deletedTier: tierId },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);
    return ok(updatedMerchant);
  }

  static async addPayoutFeeTier(
    merchantId: string,
    tier: { fromAmount: number; toAmount: number; charge: any },
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    // Check for overlapping range
    const hasOverlap = merchant.payout.fees.some(
      (f) => f.fromAmount < tier.toAmount && tier.fromAmount < f.toAmount
    );

    if (hasOverlap) {
      return err(BadRequest("Duplicate or overlapping fee range"));
    }

    const newFees = [...merchant.payout.fees, tier].sort(
      (a, b) => a.fromAmount - b.fromAmount
    );

    const updatedMerchant = await merchantRepository.update(merchantId, {
      "payout.fees": newFees,
    } as any);

    if (!updatedMerchant) return err(NotFound("Failed to add payout fee"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_ADD_PAYOUT_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { addedTier: tier },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);
    return ok(updatedMerchant);
  }

  static async deletePayoutFeeTier(
    merchantId: string,
    tierId: { fromAmount: number },
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const newFees = merchant.payout.fees.filter(
      (f) => f.fromAmount !== tierId.fromAmount
    );

    const updatedMerchant = await merchantRepository.update(merchantId, {
      "payout.fees": newFees,
    } as any);

    if (!updatedMerchant) return err(NotFound("Failed to delete payout fee"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_DELETE_PAYOUT_FEE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { deletedTier: tierId },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);
    return ok(updatedMerchant);
  }

  static async rotateApiSecret(
    merchantId: string,
    auditContext?: AuditContext
  ): Promise<Result<{ apiSecret: string }, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const newSecret = "sk_" + crypto.randomBytes(24).toString("hex");

    const updatedMerchant = await merchantRepository.update(merchantId, {
      apiSecretEncrypted: encryptSecret(newSecret),
      apiSecretUpdatedAt: getISTDate(),
      apiSecretEnabled: true,
    } as any);

    if (!updatedMerchant) return err(NotFound("Failed to rotate secret"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_ROTATE_API_SECRET",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { action: "rotated" },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);
    return ok({ apiSecret: newSecret });
  }

  static async toggleApiSecret(
    merchantId: string,
    enable: boolean,
    auditContext?: AuditContext
  ): Promise<
    Result<{ success: boolean; apiSecretEnabled: boolean }, AppError>
  > {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    await merchantRepository.update(merchantId, {
      apiSecretEnabled: enable,
    } as any);

    if (auditContext) {
      await AuditService.record({
        action: "MERCHANT_TOGGLE_API_SECRET",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { enabled: enable },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);
    return ok({ success: true, apiSecretEnabled: enable });
  }

  static async updateRouting(
    merchantId: string,
    data: {
      payinRouting?: any;
      payoutRouting?: any;
      payinRoutingFallbacks?: any[];
      payoutRoutingFallbacks?: any[];
    },
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    // Validation Logic
    const validateRouting = async (
      routing: { providerId: string; legalEntityId: string },
      type: "Payin" | "Payout"
    ) => {
      if (!routing || !routing.providerId || !routing.legalEntityId) return;

      // 1. Check Existence
      const providerExists = await ProviderModel.exists({
        id: routing.providerId,
      });
      if (!providerExists)
        throw BadRequest(`${type} Provider not found: ${routing.providerId} `);

      const leExists = await LegalEntityModel.exists({
        id: routing.legalEntityId,
      });
      if (!leExists)
        throw BadRequest(
          `${type} Legal Entity not found: ${routing.legalEntityId} `
        );

      // 2. Check Linkage
      const ple = await ProviderLegalEntityModel.findOne({
        providerId: routing.providerId,
        legalEntityId: routing.legalEntityId,
      });
      if (!ple)
        throw BadRequest(
          `${type} Channel(PLE) not found for Provider ${routing.providerId} and LE ${routing.legalEntityId} `
        );

      // 3. Check Active Status
      if (!ple.isActive) throw BadRequest(`${type} Channel(PLE) is inactive`);

      if (type === "Payin" && !ple.payin?.isActive)
        throw BadRequest(`${type} Channel is not active for Payin`);
      if (type === "Payout" && !ple.payout?.isActive)
        throw BadRequest(`${type} Channel is not active for Payout`);
    };

    const validateFallbacks = async (
      fallbacks: Array<{ providerId: string; legalEntityId: string }>,
      type: "Payin" | "Payout"
    ) => {
      if (!Array.isArray(fallbacks)) return;
      for (const fb of fallbacks) {
        await validateRouting(fb, type);
      }
    };

    try {
      if (data.payinRouting) await validateRouting(data.payinRouting, "Payin");
      if (data.payoutRouting)
        await validateRouting(data.payoutRouting, "Payout");
      if (data.payinRoutingFallbacks)
        await validateFallbacks(data.payinRoutingFallbacks, "Payin");
      if (data.payoutRoutingFallbacks)
        await validateFallbacks(data.payoutRoutingFallbacks, "Payout");
    } catch (error: any) {
      return err(error);
    }

    const previousValues = {
      payinRouting: merchant.payin.routing,
      payoutRouting: merchant.payout.routing,
      payinRoutingFallbacks: merchant.payin.routingFallbacks,
      payoutRoutingFallbacks: merchant.payout.routingFallbacks,
    };

    const updateData: any = {};
    if (data.payinRouting) updateData["payin.routing"] = data.payinRouting;
    if (data.payoutRouting) updateData["payout.routing"] = data.payoutRouting;
    if (data.payinRoutingFallbacks)
      updateData["payin.routingFallbacks"] = data.payinRoutingFallbacks;
    if (data.payoutRoutingFallbacks)
      updateData["payout.routingFallbacks"] = data.payoutRoutingFallbacks;

    const updatedMerchant = await merchantRepository.update(
      merchantId,
      updateData
    );
    if (!updatedMerchant) return err(NotFound("Failed to update routing"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_ROUTING",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { previousValues, newValues: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    const { CacheService } = await import("../common/cache.service");
    await CacheService.invalidateMerchant(merchantId);

    return ok(updatedMerchant);
  }

  static async getMerchantActivity(
    merchantId: string
  ): Promise<Result<any, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const [firstTxn, lastTxns, volumeAgg] = await Promise.all([
      TransactionModel.findOne({ merchantId, status: TransactionStatus.SUCCESS })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
      TransactionModel.find({ merchantId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      TransactionModel.aggregate([
        {
          $match: {
            merchantId,
            status: TransactionStatus.SUCCESS,
            type: TransactionType.PAYIN,
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    return ok({
      onboardedAt: merchant.createdAt,
      firstTransactionAt: firstTxn?.createdAt,
      totalVolume: volumeAgg[0]?.total || 0,
      lastTransactions: lastTxns.map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        type: t.type,
        amount: t.amount,
        status: t.status,
        currency: t.currency,
      })),
    });
  }
}
