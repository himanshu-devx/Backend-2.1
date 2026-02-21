import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import type { ActorType } from "@/types/audit-log.types";

export interface AuditLogDocument extends Document {
  action: string;
  actorId?: string;
  actorType?: ActorType | string;
  actorName?: string;
  actorRole?: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  entityType?: string;
  entityId?: string;
  prevValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<AuditLogDocument>(
  {
    action: { type: String, required: true, index: true },
    actorId: { type: String, index: true },
    actorType: { type: String },
    actorName: { type: String },
    actorRole: { type: String },
    actorEmail: { type: String },
    ipAddress: { type: String },
    userAgent: { type: String },
    entityType: { type: String, index: true },
    entityId: { type: String, index: true },
    prevValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
    requestId: { type: String, index: true },
    correlationId: { type: String, index: true },
    traceId: { type: String, index: true },
    spanId: { type: String },
    source: { type: String },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (_doc: any, ret: any) {
        delete ret._id;
        delete ret.__v;
      },
    },
    toObject: { virtuals: true },
    id: false,
  }
);

AuditLogSchema.index({ createdAt: -1 });

export const AuditLogModel: Model<AuditLogDocument> =
  mongoose.models.AuditLog ||
  mongoose.model<AuditLogDocument>("AuditLog", AuditLogSchema);
