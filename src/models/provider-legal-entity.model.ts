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

  // Configuration for this pair (e.g. API Keys)
  config: {
    apiKeyEncrypted?: string;
    apiSecretEncrypted?: string;
    webhookSecretEncrypted?: string;
  };

  payin: SharedServiceConfig;
  payout: SharedServiceConfig;

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

    config: {
      apiKeyEncrypted: String,
      apiSecretEncrypted: String,
      webhookSecretEncrypted: String,
    },

    payin: SharedServiceConfigSchema,
    payout: SharedServiceConfigSchema,
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
    id: false,
  }
);

ProviderLegalEntitySchema.pre("save", async function (next) {
  if (!this.id) {
    const { generateCustomId } = await import("@/utils/id.util");
    this.id = await generateCustomId("PLE", "provider_legal_entity");
  }
  next();
});

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
