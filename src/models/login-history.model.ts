import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";

export enum LoginStatus {
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
}

export enum ActorType {
  ADMIN = "ADMIN",
  MERCHANT = "MERCHANT",
  UNKNOWN = "UNKNOWN",
  SYSTEM = "SYSTEM",
}

export interface LoginHistoryDocument extends Document {
  userId?: string; // Optional if failed and user unknown
  userType: ActorType;
  email: string; // Captured even if user doesn't exist
  ipAddress: string;
  userAgent: string;
  browser?: string;
  os?: string;
  device?: string;
  location?: {
    country?: string;
    region?: string;
    city?: string;
    ll?: [number, number]; // Lat, Long
  };
  status: LoginStatus;
  failureReason?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const LoginHistorySchema = new Schema<LoginHistoryDocument>(
  {
    userId: { type: String, index: true },
    userType: { type: String, enum: Object.values(ActorType), required: true },
    email: { type: String, required: true, index: true },
    ipAddress: { type: String, required: true },
    userAgent: { type: String },
    browser: { type: String },
    os: { type: String },
    device: { type: String },
    location: {
      country: String,
      region: String,
      city: String,
      ll: [Number],
    },
    status: { type: String, enum: Object.values(LoginStatus), required: true },
    failureReason: { type: String },
    metadata: { type: Object },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Index for getting recent history by user
LoginHistorySchema.index({ userId: 1, createdAt: -1 });

export const LoginHistoryModel: Model<LoginHistoryDocument> =
  mongoose.models.LoginHistory ||
  mongoose.model<LoginHistoryDocument>("LoginHistory", LoginHistorySchema);
