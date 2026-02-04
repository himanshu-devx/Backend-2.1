import { BankAccountStatus } from "@/constants/utils.constant";

import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { getISTDate } from "@/utils/date.util";

export interface MerchantBankAccountDocument extends Document {
  id: string; // WA-{seq}
  merchantId: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  beneficiaryName: string;
  status: BankAccountStatus;
  rejectReason?: string;
  isActive: boolean; // Admin control to enable/disable usage without rejecting
  approvedBy?: string;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MerchantBankAccountSchema = new Schema<MerchantBankAccountDocument>(
  {
    id: { type: String, unique: true, required: true, index: true },
    merchantId: {
      type: String, // Still string ref if Merchant ID is string? Yes, we made Merchant use 'id' field?
      // Wait, Merchant now has _id=ObjectId and id=String.
      // If we Reference "Merchant", Mongoose stores the _id by default.
      // But we stored custom ID in 'merchantId'.
      // If we want to store custom ID, we keep type: String.
      // If we want to store ObjectId, we use ref type.
      // The Plan was "Replace all _id with custom ID".
      // We decided to Pivot for the PK.
      // But for REFERENCES (Foreign Keys), we should probably use the Custom String ID if strictly following "human readable" refs.
      // OR use ObjectId refs.
      // Given "merchantId" is likely purely a string reference in our logic (we query by it), let's keep it String.
      ref: "Merchant",
      required: true,
      index: true,
    },
    accountNumber: { type: String, required: true, trim: true },
    ifsc: { type: String, required: true, trim: true, uppercase: true },
    bankName: { type: String, required: true, trim: true },
    beneficiaryName: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(BankAccountStatus),
      default: BankAccountStatus.PENDING,
      index: true,
    },
    rejectReason: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    approvedBy: { type: String, ref: "Admin" },
    approvedAt: { type: Date },
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

MerchantBankAccountSchema.pre("save", async function (next) {
  if (!this.id) {
    const { generateCustomId } = await import("@/utils/id.util");
    this.id = await generateCustomId("WA", "merchant_bank_account");
  }
  next();
});

// Compound index to prevent duplicate accounts for same merchant?
// Or maybe just allow it but warn? Let's check uniqueness on account number + ifsc per merchant.
MerchantBankAccountSchema.index(
  { merchantId: 1, accountNumber: 1, ifsc: 1 },
  { unique: true }
);

export const MerchantBankAccountModel: Model<MerchantBankAccountDocument> =
  mongoose.models.MerchantBankAccount ||
  mongoose.model<MerchantBankAccountDocument>(
    "MerchantBankAccount",
    MerchantBankAccountSchema
  );
