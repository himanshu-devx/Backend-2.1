import { Schema } from "mongoose";

export interface FeeComponent {
  flat: number;
  percentage: number;
  taxRate: number;
}

export interface FeeTier {
  fromAmount: number;
  toAmount: number;
  charge: FeeComponent;
}

export interface SharedServiceConfig {
  isActive: boolean;
  fees: FeeTier[];
  tps: number;

  dailyLimit: number;
  minAmount?: number;
  maxAmount?: number;

  // IP Whitelisting (Optional here, but commonly used)
  apiIpWhitelist?: string[];
  isApiIpWhitelistEnabled?: boolean;

  configType?: "PAYIN" | "PAYOUT";
  callbackUrl?: string;

  routing?: {
    providerId: string;
    legalEntityId: string;
  };
  routingFallbacks?: {
    providerId: string;
    legalEntityId: string;
  }[];
}

const FeeComponentSchema = new Schema(
  {
    flat: { type: Number, required: true, default: 0, min: 0 },
    percentage: { type: Number, required: true, default: 0, min: 0 },
    taxRate: { type: Number, required: true, default: 18, min: 0 },
    strategy: {
      type: String,
      enum: ["SUM", "MAX"],
      default: "SUM",
    },
  },
  { _id: false }
);

const FeeTierSchema = new Schema(
  {
    fromAmount: { type: Number, required: true, default: 0, min: 0 },
    toAmount: { type: Number, required: true, default: -1 },
    charge: { type: FeeComponentSchema, required: true, default: () => ({}) },
  },
  { _id: false }
);

export const SharedServiceConfigSchema = new Schema(
  {
    isActive: { type: Boolean, default: false },
    fees: { type: [FeeTierSchema], default: [] },
    tps: { type: Number, default: 5, min: 1 },

    dailyLimit: { type: Number, default: 5000000, min: 0 },
    minAmount: { type: Number, min: 0 },
    maxAmount: { type: Number, min: 0 },

    // IP Whitelisting
    apiIpWhitelist: {
      type: [String],
      default: [],
      validate: [
        (val: string[]) => val.length <= 5,
        "Maximum 5 IPs allowed in whitelist",
      ],
    },
    isApiIpWhitelistEnabled: { type: Boolean, default: false },

    configType: {
      type: String,
      enum: ["PAYIN", "PAYOUT"],
    },
    callbackUrl: { type: String, trim: true },
    routing: {
      providerId: { type: String },
      legalEntityId: { type: String },
    },
    routingFallbacks: {
      type: [
        {
          providerId: { type: String },
          legalEntityId: { type: String },
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

// Fee Tier Validation Helper
export function validateTiers(tiers: FeeTier[]) {
  if (!Array.isArray(tiers)) return true;
  const sorted = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (t.fromAmount < 0) return false;
    if (t.toAmount !== -1 && t.toAmount < t.fromAmount) return false;
    if (i > 0) {
      const prev = sorted[i - 1];
      const prevTo = prev.toAmount === -1 ? Infinity : prev.toAmount;
      if (t.fromAmount <= prevTo) return false;
    }
  }
  return true;
}
