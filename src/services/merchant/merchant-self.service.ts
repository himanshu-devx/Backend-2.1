import { ok, err, Result } from "@/utils/result";
import { AppError, NotFound, Unauthorized } from "@/utils/error";
import { merchantRepository } from "@/repositories/merchant.repository";
import { AuditService } from "../common/audit.service";
import { AuditContext } from "@/utils/audit.util";
import { redis } from "@/infra/redis-instance";
import { RedisKeys } from "@/constants/redis.constant";
import { MerchantManagementService } from "../admin/merchant-management.service";
import argon2 from "argon2";
import crypto from "crypto";
import { getISTDate } from "@/utils/date.util";

export class MerchantSelfService {
  // Use MerchantManagementService for read operations to avoid code duplication
  // Since reads are largely the same (just context differs - "Own" vs "Admin looking at ID")

  static async getOwnProfile(id: string) {
    return MerchantManagementService.getMerchantById(id);
  }

  static async getOwnBasicProfile(id: string) {
    const key = RedisKeys.MERCHANT_CONFIG.PROFILE(id);
    const cached = await redis.get(key);

    if (cached) {
      try {
        return ok(JSON.parse(cached));
      } catch (e) { }
    }
    const fullResult = await this.getOwnProfile(id);
    if (!fullResult.ok) return fullResult;

    const { name, email, role, status, isOnboard, createdAt, updatedAt } =
      fullResult.value;
    return ok({
      name,
      email,
      id,
      mid: id,
      role,
      status,
      isOnboard,
      createdAt,
      updatedAt,
      displayName: fullResult.value.displayName,
    });
  }

  static async getOwnPayinConfig(id: string) {
    const cKey = RedisKeys.MERCHANT_CONFIG.PAYIN_CONFIG(id);
    const fKey = RedisKeys.MERCHANT_CONFIG.PAYIN_FEES(id);
    const [cachedConfig, cachedFees] = await redis.mget(cKey, fKey);

    if (cachedConfig && cachedFees) {
      try {
        const config = JSON.parse(cachedConfig);
        const fees = JSON.parse(cachedFees);
        return ok({ ...config, fees });
      } catch (e) { }
    }

    const fullResult = await this.getOwnProfile(id);
    if (!fullResult.ok) return fullResult;
    return ok(fullResult.value.payin);
  }

  static async getOwnPayoutConfig(id: string) {
    const cKey = RedisKeys.MERCHANT_CONFIG.PAYOUT_CONFIG(id);
    const fKey = RedisKeys.MERCHANT_CONFIG.PAYOUT_FEES(id);
    const [cachedConfig, cachedFees] = await redis.mget(cKey, fKey);

    if (cachedConfig && cachedFees) {
      try {
        const config = JSON.parse(cachedConfig);
        const fees = JSON.parse(cachedFees);
        return ok({ ...config, fees });
      } catch (e) { }
    }
    const fullResult = await this.getOwnProfile(id);
    if (!fullResult.ok) return fullResult;
    return ok(fullResult.value.payout);
  }

  static async getOwnApiKeys(id: string) {
    const fullResult = await MerchantManagementService.getMerchantById(id);
    if (!fullResult.ok) return fullResult;

    const {
      panelIpWhitelist,
      isPanelIpWhitelistEnabled,
      payin,
      payout,
      apiSecretEnabled,
      apiSecretUpdatedAt,
    } = fullResult.value;

    return ok({
      panelIpWhitelist,
      isPanelIpWhitelistEnabled,
      payinIpWhitelist: payin?.apiIpWhitelist || [],
      isPayinIpWhitelistEnabled: payin?.isApiIpWhitelistEnabled || false,
      payoutIpWhitelist: payout?.apiIpWhitelist || [],
      isPayoutIpWhitelistEnabled: payout?.isApiIpWhitelistEnabled || false,
      apiSecretEnabled,
      apiSecretUpdatedAt,
      apiKey: fullResult.value.id,
      id,
    });
  }

  // --- NEW FEATURES ---

  static async updateCallbackUrl(
    merchantId: string,
    type: "PAYIN" | "PAYOUT",
    url: string,
    auditContext?: AuditContext
  ): Promise<Result<{ callbackUrl: string }, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const updateField =
      type === "PAYIN" ? "payin.callbackUrl" : "payout.callbackUrl";

    const previousUrl =
      type === "PAYIN"
        ? merchant.payin.callbackUrl
        : merchant.payout.callbackUrl;

    const updatedMerchant = await merchantRepository.update(merchantId, {
      [updateField]: url,
    } as any);

    if (!updatedMerchant) return err(NotFound("Failed to update callback URL"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_CALLBACK",
        actorType: "MERCHANT", // Self update
        actorId: merchant.email,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { type, previousUrl, newUrl: url },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    if (type === "PAYIN") {
      await redis.del(RedisKeys.MERCHANT_CONFIG.PAYIN_CONFIG(merchantId));
    } else {
      await redis.del(RedisKeys.MERCHANT_CONFIG.PAYOUT_CONFIG(merchantId));
    }

    return ok({ callbackUrl: url });
  }

  static async rotateApiSecret(
    merchantId: string,
    auditContext?: AuditContext
  ): Promise<Result<{ apiSecret: string }, AppError>> {
    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const newSecret = "sk_" + crypto.randomBytes(24).toString("hex");
    const hashedSecret = await argon2.hash(newSecret);

    const updatedMerchant = await merchantRepository.update(merchantId, {
      apiSecretEncrypted: hashedSecret,
      apiSecretUpdatedAt: getISTDate(),
      apiSecretEnabled: true,
    } as any);

    if (!updatedMerchant) return err(NotFound("Failed to rotate secret"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_ROTATE_API_SECRET",
        actorType: "MERCHANT", // Self
        actorId: merchant.email,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { action: "rotated_self" },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    await redis.del(RedisKeys.MERCHANT_CONFIG.API_KEYS(merchantId));
    return ok({ apiSecret: newSecret });
  }

  static async updateSelfProfile(
    merchantId: string,
    data: { displayName?: string },
    auditContext?: AuditContext
  ): Promise<Result<any, AppError>> {
    if (!data.displayName)
      return err(new AppError("Nothing to update", { status: 400 }));

    const merchant = await merchantRepository.findById(merchantId);
    if (!merchant) return err(NotFound("Merchant not found"));

    const previousName = merchant.displayName || merchant.name;
    const updatedMerchant = await merchantRepository.update(merchantId, {
      displayName: data.displayName,
    });

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_PROFILE",
        actorType: "MERCHANT",
        actorId: merchant.email,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { previousName, newDisplayName: data.displayName },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    await redis.del(RedisKeys.MERCHANT_CONFIG.PROFILE(merchantId));
    return ok({ displayName: data.displayName });
  }

  static async getDashboardStats(
    merchantId: string,
    params: { startDate?: Date; endDate?: Date }
  ): Promise<Result<any, AppError>> {
    // 1. Try to fetch from Redis
    const cacheKey = RedisKeys.MERCHANT_CONFIG.STATS(
      merchantId,
      params.startDate?.toISOString(),
      params.endDate?.toISOString()
    );
    const cached = await redis.get(cacheKey);

    if (cached) {
      try {
        return ok(JSON.parse(cached));
      } catch (e) { }
    }

    // 2. Compute if not in cache
    const { AnalyticsService } = await import(
      "@/services/analytics/analytics.service"
    );
    const analytics = await AnalyticsService.getMerchantAnalytics(merchantId, params);

    // 3. Cache the result for 60 seconds (short-lived for dashboard)
    await redis.setex(cacheKey, 60, JSON.stringify(analytics));

    return ok(analytics);
  }
}
