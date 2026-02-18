import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { generateCustomId } from "@/utils/id.util";

export enum OutboxStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  SENT = "SENT",
  FAILED = "FAILED",
}

export interface OutboxDocument extends Document {
  id: string;
  type: string;
  status: OutboxStatus;
  payload: any;
  dedupeKey: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OutboxSchema = new Schema<OutboxDocument>(
  {
    id: { type: String, unique: true, required: true, index: true },
    type: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(OutboxStatus),
      default: OutboxStatus.PENDING,
      index: true,
    },
    payload: { type: Schema.Types.Mixed, required: true },
    dedupeKey: { type: String, required: true, unique: true, index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 8 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lastError: { type: String },
  },
  {
    timestamps: true,
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

OutboxSchema.index({ status: 1, nextAttemptAt: 1 });

OutboxSchema.pre("validate", async function (this: OutboxDocument, next) {
  if (!this.id) {
    this.id = await generateCustomId("OBX", "outbox");
  }
  next();
});

export const OutboxModel: Model<OutboxDocument> =
  mongoose.models.Outbox || mongoose.model<OutboxDocument>("Outbox", OutboxSchema);
