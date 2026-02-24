export const RedisKeys = {
  OTP: {
    ADMIN: (email: string) => `otp:admin:${email}`,
    MERCHANT: (email: string) => `otp:merchant:${email}`,
  },
  DEVICE: {
    ADMIN: (email: string, deviceId: string) =>
      `device:admin:${email}:${deviceId}`,
    MERCHANT: (email: string, deviceId: string) =>
      `device:merchant:${email}:${deviceId}`,
  },
  PASSWORD_RESET: {
    ADMIN: (token: string) => `reset-password:admin:${token}`,
    MERCHANT: (token: string) => `reset-password:merchant:${token}`,
  },
  MERCHANT_CONFIG: {
    PROFILE: (id: string) => `merchant:profile:${id}`,
    PAYIN_CONFIG: (id: string) => `merchant:payin-config:${id}`,
    PAYIN_FEES: (id: string) => `merchant:payin-fees:${id}`,
    PAYOUT_CONFIG: (id: string) => `merchant:payout-config:${id}`,
    PAYOUT_FEES: (id: string) => `merchant:payout-fees:${id}`,
    API_KEYS: (id: string) => `merchant:api-keys:${id}`,
    // Stats caching
    STATS: (id: string, start?: string, end?: string) =>
      `merchant:stats:${id}:${start || "all"}:${end || "all"}`,
  },
  ADMIN_CONFIG: {
    PROFILE: (id: string) => `admin:profile:${id}`,
    API_KEYS: (id: string) => `admin:api-keys:${id}`,
  },
  PROVIDER: {
    TYPE: (id: string) => `provider:type:${id}`,
  },
  CHANNEL: (providerId: string, legalEntityId: string) =>
    `channel:${providerId}:${legalEntityId}`,
  PAYIN_INTENT: (transactionId: string) => `payin:intent:${transactionId}`,
} as const;
