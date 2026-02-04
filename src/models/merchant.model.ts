import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import argon2 from "argon2";
import { MERCHANT_ROLES, MerchantRoleType } from "@/constants/users.constant";
import {
  SharedServiceConfig,
  SharedServiceConfigSchema,
  validateTiers,
} from "./shared/service-config.schema";
import { getISTDate } from "@/utils/date.util";

/* ---------------------------
   Interfaces
   --------------------------- */
export interface MerchantDocument extends Document {
  id: string; // MID-{seq}
  name: string;
  displayName: string;
  email: string;
  password: string;
  role: MerchantRoleType;
  status: boolean;
  panelIpWhitelist: string[];
  isPanelIpWhitelistEnabled: boolean;
  isOnboard: boolean;
  createdAt: Date;
  updatedAt: Date;

  apiSecretEncrypted?: string;
  apiSecretUpdatedAt?: Date;
  apiSecretEnabled?: boolean;

  payin: SharedServiceConfig;
  payout: SharedServiceConfig;

  comparePassword(candidate: string): Promise<boolean>;
  disableMerchant(reason?: string): Promise<void>;
  enableMerchant(): Promise<void>;
}

/* ---------------------------
   Merchant schema
   --------------------------- */
const MerchantSchema = new Schema<MerchantDocument>(
  {
    id: {
      type: String,
      unique: true,
      required: true,
      index: true,
    }, // MID-{seq}

    name: { type: String, required: true, trim: true },
    displayName: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // mid: removed
    password: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: Object.values(MERCHANT_ROLES),
      default: MERCHANT_ROLES.MERCHANT,
    },
    status: {
      type: Boolean,
      default: true,
    },

    panelIpWhitelist: { type: [String], default: [] },
    isPanelIpWhitelistEnabled: { type: Boolean, default: false },
    isOnboard: { type: Boolean, default: false },

    apiSecretEncrypted: { type: String, select: false, default: null },
    apiSecretUpdatedAt: { type: Date, default: null },
    apiSecretEnabled: { type: Boolean, default: true },

    payin: {
      type: SharedServiceConfigSchema,
      required: true,
      default: () => ({}),
    },
    payout: {
      type: SharedServiceConfigSchema,
      required: true,
      default: () => ({}),
    },
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
    id: false, // Disable default id virtual
  }
);

/* ---------------------------
   Indexes (Optimized for Query & List)
   --------------------------- */
MerchantSchema.index({ status: 1 });
MerchantSchema.index({ role: 1 });
MerchantSchema.index({ createdAt: -1 }); // Optimized for list sorting
MerchantSchema.index({ "payin.isActive": 1 });
MerchantSchema.index({ "payout.isActive": 1 });

/* ---------------------------
   Hide sensitive fields on JSON
   --------------------------- */
MerchantSchema.set("toJSON", {
  virtuals: true,
  transform(doc: any, ret: any) {
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    delete ret.apiSecretEncrypted;
    return ret;
  },
});

/* ---------------------------
   Fee-tier validation
   --------------------------- */
MerchantSchema.path("payin.fees").validate(
  validateTiers,
  "Invalid payin fee tiers"
);
MerchantSchema.path("payout.fees").validate(
  validateTiers,
  "Invalid payout fee tiers"
);

/* ---------------------------
   Password hashing
   --------------------------- */
const ARGON2_OPTIONS: argon2.Options = { type: argon2.argon2id };

MerchantSchema.pre("save", async function (next) {
  const doc: any = this;

  if (doc.isModified("email")) {
    doc.email = doc.email.trim().toLowerCase();
  }

  if (!doc.displayName && doc.name) {
    doc.displayName = doc.name;
  }

  if (!doc.isModified("password")) return next();
});

// Hash password before save
MerchantSchema.pre("save", async function (this: MerchantDocument, next) {
  if (!this.id) {
    const { generateCustomId } = await import("@/utils/id.util");
    this.id = await generateCustomId("MID", "merchant");
  }

  if (!this.isModified("password")) return next();

  try {
    this.password = await argon2.hash(this.password, ARGON2_OPTIONS);
    next();
  } catch (err) {
    next(err as Error);
  }
});

// Instance method to compare passwords
MerchantSchema.methods.comparePassword = function (
  this: MerchantDocument,
  candidate: string
) {
  return argon2.verify(this.password, candidate);
};

MerchantSchema.methods.disableMerchant = async function () {
  const doc: any = this;
  doc.status = false;
  doc.apiSecretEnabled = false;
  await doc.save();
};

MerchantSchema.methods.enableMerchant = async function () {
  const doc: any = this;
  doc.status = true;
  // doc.apiSecretEnabled = true;
  await doc.save();
};

/* ---------------------------
   Export
   --------------------------- */
export const MerchantModel: Model<MerchantDocument> =
  mongoose.models.Merchant ||
  mongoose.model<MerchantDocument>("Merchant", MerchantSchema);
