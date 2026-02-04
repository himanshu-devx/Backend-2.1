import { Schema, model, Document, Types } from "mongoose";
import { getISTDate } from "@/utils/date.util";

export interface LedgerAccountDocument extends Document {
  accountId: string; // 128-bit ID as string
  ownerId: string; // Ref to Merchant / LE / PLE (Custom ID)
  ownerName: string; // Cached name for easier display
  ownerType: "MERCHANT" | "LEGAL_ENTITY" | "PROVIDER" | "SUPER_ADMIN" | "PROVIDER_LEGAL_ENTITY";
  typeSlug: string; // Ref to LedgerAccountType.slug
  currency: number;
  isActive: boolean;
  allowOverdraft: boolean;
  createdAt: Date;
}

const ledgerAccountSchema = new Schema<LedgerAccountDocument>(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    ownerId: { type: String, required: true, index: true },
    ownerName: { type: String, required: true },
    ownerType: {
      type: String,
      required: true,
      // Using values from OWNER_TYPE keys for Mongo storage to stay readable
      enum: ["MERCHANT", "LEGAL_ENTITY", "PROVIDER", "SUPER_ADMIN", "PROVIDER_LEGAL_ENTITY"],
    },
    typeSlug: { type: String, required: true, index: true },
    isActive: { type: Boolean, default: true },
    allowOverdraft: { type: Boolean, default: false },
    currency: { type: Number, default: 356 }, // Hardcoded 356 (INR) as CURRENCY.INR is const
  },
  { timestamps: { currentTime: getISTDate } }
);

// Compound index for quick lookup: Find all accounts for a merchant
ledgerAccountSchema.index({ ownerId: 1, typeSlug: 1 });

export const LedgerAccountModel = model<LedgerAccountDocument>(
  "LedgerAccount",
  ledgerAccountSchema
);
