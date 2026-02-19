import { redis } from "@/infra/redis-instance";
import { RedisKeys } from "@/constants/redis.constant";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { ProviderModel } from "@/models/provider.model";
import { resolvePayoutPollImmediate } from "@/config/payout-poll.config";

export class CacheService {
  private static TTL = 3600; // 1 hour

  private static applyChannelOverrides(channel: any) {
    if (!channel) return channel;
    channel.payout = channel.payout || {};
    channel.payout.pollImmediately = resolvePayoutPollImmediate(
      channel.providerId,
      channel.legalEntityId
    );
    return channel;
  }

  /**
   * Get Merchant from cache or DB
   */
  static async getMerchant(id: string): Promise<any> {
    const keys = {
      profile: RedisKeys.MERCHANT_CONFIG.PROFILE(id),
      payin: RedisKeys.MERCHANT_CONFIG.PAYIN_CONFIG(id),
      payinFees: RedisKeys.MERCHANT_CONFIG.PAYIN_FEES(id),
      payout: RedisKeys.MERCHANT_CONFIG.PAYOUT_CONFIG(id),
      payoutFees: RedisKeys.MERCHANT_CONFIG.PAYOUT_FEES(id),
      apiKeys: RedisKeys.MERCHANT_CONFIG.API_KEYS(id),
    };

    const cachedValues = await redis.mget(
      keys.profile,
      keys.payin,
      keys.payinFees,
      keys.payout,
      keys.payoutFees,
      keys.apiKeys
    );

    const [
      cachedProfile,
      cachedPayin,
      cachedPayinFees,
      cachedPayout,
      cachedPayoutFees,
      cachedApiKeys,
    ] = cachedValues;

    if (
      cachedProfile &&
      cachedPayin &&
      cachedPayinFees &&
      cachedPayout &&
      cachedPayoutFees &&
      cachedApiKeys
    ) {
      try {
        const profile = JSON.parse(cachedProfile);
        const payin = JSON.parse(cachedPayin);
        const payinFees = JSON.parse(cachedPayinFees);
        const payout = JSON.parse(cachedPayout);
        const payoutFees = JSON.parse(cachedPayoutFees);
        const apiKeys = JSON.parse(cachedApiKeys);

        return {
          ...profile,
          ...apiKeys,
          payin: { ...payin, fees: payinFees },
          payout: { ...payout, fees: payoutFees },
          id,
        };
      } catch (e) {
        // Fallback to DB
      }
    }

    // DB Fallback
    const merchant = await MerchantModel.findOne({ id }).select(
      "+apiSecretEncrypted"
    );
    if (!merchant) return null;

    const mData = merchant.toObject();
    await this.setMerchant(id, mData);

    return mData;
  }

  /**
   * Cache Merchant Config in Chunks
   */
  static async setMerchant(id: string, mData: any) {
    const keys = {
      profile: RedisKeys.MERCHANT_CONFIG.PROFILE(id),
      payin: RedisKeys.MERCHANT_CONFIG.PAYIN_CONFIG(id),
      payinFees: RedisKeys.MERCHANT_CONFIG.PAYIN_FEES(id),
      payout: RedisKeys.MERCHANT_CONFIG.PAYOUT_CONFIG(id),
      payoutFees: RedisKeys.MERCHANT_CONFIG.PAYOUT_FEES(id),
      apiKeys: RedisKeys.MERCHANT_CONFIG.API_KEYS(id),
    };

    const profileData = {
      name: mData.name,
      email: mData.email,
      id: mData.id,
      role: mData.role,
      status: mData.status,
      isOnboard: mData.isOnboard,
      apiSecretEncrypted: mData.apiSecretEncrypted, // Crucial for signature verification
    };

    const apiKeysData = {
      panelIpWhitelist: mData.panelIpWhitelist,
      isPanelIpWhitelistEnabled: mData.isPanelIpWhitelistEnabled,
      payinIpWhitelist: mData.payin?.apiIpWhitelist || [],
      isPayinIpWhitelistEnabled: mData.payin?.isApiIpWhitelistEnabled || false,
      payoutIpWhitelist: mData.payout?.apiIpWhitelist || [],
      isPayoutIpWhitelistEnabled:
        mData.payout?.isApiIpWhitelistEnabled || false,
      apiSecretEnabled: mData.apiSecretEnabled,
    };

    const payinOnly = { ...mData.payin };
    const payinFees = payinOnly.fees || [];
    delete payinOnly.fees;

    const payoutOnly = { ...mData.payout };
    const payoutFees = payoutOnly.fees || [];
    delete payoutOnly.fees;

    const pipe = redis.pipeline();
    pipe.setex(keys.profile, this.TTL, JSON.stringify(profileData));
    pipe.setex(keys.payin, this.TTL, JSON.stringify(payinOnly));
    pipe.setex(keys.payinFees, this.TTL, JSON.stringify(payinFees));
    pipe.setex(keys.payout, this.TTL, JSON.stringify(payoutOnly));
    pipe.setex(keys.payoutFees, this.TTL, JSON.stringify(payoutFees));
    pipe.setex(keys.apiKeys, this.TTL, JSON.stringify(apiKeysData));
    await pipe.exec();
  }

  /**
   * Get Channel (PLE) from cache or DB
   */
  static async getChannel(
    providerId: string,
    legalEntityId: string
  ): Promise<any> {
    const key = RedisKeys.CHANNEL(providerId, legalEntityId);
    const cached = await redis.get(key);
    if (cached) return this.applyChannelOverrides(JSON.parse(cached));

    const channel = await ProviderLegalEntityModel.findOne({
      providerId,
      legalEntityId,
    });
    if (!channel) return null;

    const cData = channel.toJSON();
    await redis.setex(key, this.TTL, JSON.stringify(cData));
    return this.applyChannelOverrides(cData);
  }

  /**
   * Get Channel (PLE) from cache or DB by internal channel ID
   */
  static async getChannelById(id: string): Promise<any> {
    const key = `chan:${id}`;
    const cached = await redis.get(key);
    if (cached) return this.applyChannelOverrides(JSON.parse(cached));

    const channel = await ProviderLegalEntityModel.findOne({ id });
    if (!channel) return null;

    const cData = channel.toJSON();
    await redis.setex(key, this.TTL, JSON.stringify(cData));
    return this.applyChannelOverrides(cData);
  }

  /**
   * Invalidate Merchant Cache
   */
  static async invalidateMerchant(id: string) {
    const pipe = redis.pipeline();
    pipe.del(RedisKeys.MERCHANT_CONFIG.PROFILE(id));
    pipe.del(RedisKeys.MERCHANT_CONFIG.PAYIN_CONFIG(id));
    pipe.del(RedisKeys.MERCHANT_CONFIG.PAYIN_FEES(id));
    pipe.del(RedisKeys.MERCHANT_CONFIG.PAYOUT_CONFIG(id));
    pipe.del(RedisKeys.MERCHANT_CONFIG.PAYOUT_FEES(id));
    pipe.del(RedisKeys.MERCHANT_CONFIG.API_KEYS(id));
    // Also invalidate stats to be safe
    const statsPattern = RedisKeys.MERCHANT_CONFIG.STATS(id, "*", "*");
    // Redis cluster/sharding usually doesn't support glob delete in pipeline directly without explicit keys
    // But ioredis pipeline del accepts keys.
    // For wildcard delete, we need to scan.
    // However, to keep it simple and performance friendly, we will rely on specific methods or TTL.
    // Or we can assume 'all'/'all' is the main one.
    pipe.del(RedisKeys.MERCHANT_CONFIG.STATS(id));
    await pipe.exec();

    // Use scan for stats
    await this.invalidateStats(id);
  }

  /**
   * Invalidate Merchant Stats
   */
  static async invalidateStats(id: string) {
    // Scan for all stats keys regarding this merchant
    const pattern = `merchant:stats:${id}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  }

  /**
   * Invalidate Channel Cache
   */
  static async invalidateChannel(providerId: string, legalEntityId: string) {
    await redis.del(RedisKeys.CHANNEL(providerId, legalEntityId));
  }

  /**
   * Get Provider Type from cache or DB
   */
  static async getProviderType(id: string): Promise<"BANK" | "GATEWAY"> {
    const key = RedisKeys.PROVIDER.TYPE(id);
    const cached = await redis.get(key);
    if (cached === "BANK" || cached === "GATEWAY") return cached;

    const provider = await ProviderModel.findOne({ id }).select("type");
    if (!provider) throw new Error(`Provider not found: ${id}`);

    const type = provider.type as "BANK" | "GATEWAY";
    await redis.setex(key, this.TTL, type);
    return type;
  }

  static async invalidateProviderType(id: string) {
    await redis.del(RedisKeys.PROVIDER.TYPE(id));
  }

  // Ledger account cache removed (ledger-only mode)
}
