import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { getISTDate } from "@/utils/date.util";
import {
  SharedServiceConfig,
  SharedServiceConfigSchema,
  validateTiers,
} from "./shared/service-config.schema";

export interface ProviderLegalEntityDocument extends Document {
  id: string; // PLE-{seq}
  name?: string;
  providerId: string;
  legalEntityId: string;

  payin: SharedServiceConfig;
  payout: SharedServiceConfig;

  // Configurations
  integration?: {
    providerType: string;
    requiredEnvKeys: string[];
  };
  webhooks?: {
    payin: string | null;
    payout: string | null;
    common: string | null;
  };

  // Ledger account IDs
  accounts?: {
    payinAccountId?: string;
    payoutAccountId?: string;
    expenseAccountId?: string;
  };

  isActive: boolean;
  isOnboard: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProviderLegalEntitySchema = new Schema<ProviderLegalEntityDocument>(
  {
    id: { type: String, unique: true, required: true, index: true },
    name: { type: String },
    providerId: {
      type: String,
      ref: "Provider",
      required: true,
    },
    legalEntityId: {
      type: String,
      ref: "LegalEntity",
      required: true,
    },

    payin: SharedServiceConfigSchema,
    payout: SharedServiceConfigSchema,

    // Ledger account IDs
    accounts: {
      type: {
        payinAccountId: { type: String },
        payoutAccountId: { type: String },
        expenseAccountId: { type: String },
      },
      default: {},
    },

    integration: {
      providerType: { type: String },
      requiredEnvKeys: { type: [String], default: [] },
    },
    webhooks: {
      payin: { type: String },
      payout: { type: String },
      common: { type: String },
    },

    isActive: { type: Boolean, default: true },
    isOnboard: { type: Boolean, default: false },
  },
  {
    timestamps: { currentTime: getISTDate },
    toJSON: {
      virtuals: true,
      transform: function (doc: any, ret: any) {
        delete ret._id;
        delete ret.__v;
      },
    },
    toObject: { virtuals: true },
  }
);

// Composite unique index
ProviderLegalEntitySchema.index(
  { providerId: 1, legalEntityId: 1 },
  { unique: true }
);

ProviderLegalEntitySchema.path("payin.fees").validate(
  validateTiers,
  "Invalid payin fee tiers"
);
ProviderLegalEntitySchema.path("payout.fees").validate(
  validateTiers,
  "Invalid payout fee tiers"
);

export const ProviderLegalEntityModel: Model<ProviderLegalEntityDocument> =
  mongoose.models.ProviderLegalEntity ||
  mongoose.model<ProviderLegalEntityDocument>(
    "ProviderLegalEntity",
    ProviderLegalEntitySchema
  );
