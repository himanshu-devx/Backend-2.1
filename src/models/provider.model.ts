import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { getISTDate } from "@/utils/date.util";

export interface ProviderDocument extends Document {
  id: string; // Slug (e.g., 'zyro')
  name: string;
  displayName: string;
  type: "BANK" | "GATEWAY";
  isActive: boolean;
  capabilities: {
    payin: boolean;
    payout: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProviderSchema = new Schema<ProviderDocument>(
  {
    id: { type: String, unique: true, required: true, index: true },
    name: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, trim: true },
    type: { type: String, enum: ["BANK", "GATEWAY"], required: true },
    isActive: { type: Boolean, default: true },
    capabilities: {
      payin: { type: Boolean, default: false },
      payout: { type: Boolean, default: false },
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
  }
);

ProviderSchema.pre("save", async function (next) {
  if (!this.displayName && this.name) {
    this.displayName = this.name;
  }
  next();
});

export const ProviderModel: Model<ProviderDocument> =
  mongoose.models.Provider ||
  mongoose.model<ProviderDocument>("Provider", ProviderSchema);
