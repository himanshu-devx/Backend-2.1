import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { getISTDate } from "@/utils/date.util";

export interface LegalEntityDocument extends Document {
  id: string; // Slug (e.g., 'zyro')
  name: string;
  displayName: string;
  identifier: string; // CIN or PAN
  gstin?: string;
  bankAccount?: {
    accountNumber: string;
    ifsc: string;
    bankName: string;
    beneficiaryName: string;
  };
  isActive: boolean;
  isOnboard: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LegalEntitySchema = new Schema<LegalEntityDocument>(
  {
    id: { type: String, unique: true, required: true, index: true },
    name: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, trim: true },
    identifier: { type: String, required: true, trim: true, uppercase: true },
    gstin: { type: String, trim: true, uppercase: true },
    bankAccount: {
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true, uppercase: true },
      bankName: { type: String, trim: true },
      beneficiaryName: { type: String, trim: true },
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
    id: false,
  }
);

LegalEntitySchema.pre("save", async function (next) {
  if (!this.id && this.name) {
    const { generateSlug } = await import("@/utils/id.util");
    this.id = generateSlug(this.name);
  }
  if (!this.displayName && this.name) {
    this.displayName = this.name;
  }
  next();
});

export const LegalEntityModel: Model<LegalEntityDocument> =
  mongoose.models.LegalEntity ||
  mongoose.model<LegalEntityDocument>("LegalEntity", LegalEntitySchema);
