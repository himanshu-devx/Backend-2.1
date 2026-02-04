import mongoose, { Document, Schema } from "mongoose";

export interface AuditLogDocument extends Document {
    action: string;
    status: "SUCCESS" | "FAILURE";
    error?: any;
    metadata?: any;
    actorId?: string;
    ip?: string;
    timestamp: Date;
}

const AuditLogSchema = new Schema({
    action: { type: String, required: true },
    status: { type: String, enum: ["SUCCESS", "FAILURE"], required: true },
    error: { type: Schema.Types.Mixed }, // Store JSON error
    metadata: { type: Schema.Types.Mixed },
    actorId: { type: String },
    ip: { type: String },
    timestamp: { type: Date, default: Date.now, index: { expires: '30d' } }
});

export const AuditLogModel = mongoose.model<AuditLogDocument>("AuditLog", AuditLogSchema);
