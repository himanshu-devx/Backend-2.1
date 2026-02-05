import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { getISTDate } from "@/utils/date.util";

export enum ReportStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
}

export enum ReportType {
    TRANSACTIONS = "TRANSACTIONS",
    LEDGER_STATEMENT = "LEDGER_STATEMENT",
}

export interface GeneratedReportDocument extends Document {
    id: string;
    type: ReportType;
    status: ReportStatus;

    ownerId: string;
    ownerType: "MERCHANT" | "ADMIN";
    ownerEmail: string;

    filters: any;
    metadata?: any;
    filename?: string;
    filePath?: string;
    fileSize?: number;

    error?: string;

    processedAt?: Date;
    expiresAt: Date;

    createdAt: Date;
    updatedAt: Date;
}

const GeneratedReportSchema = new Schema<GeneratedReportDocument>(
    {
        id: { type: String, unique: true, required: true, index: true },
        type: {
            type: String,
            enum: Object.values(ReportType),
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(ReportStatus),
            default: ReportStatus.PENDING,
            index: true,
        },
        ownerId: { type: String, required: true, index: true },
        ownerType: {
            type: String,
            enum: ["MERCHANT", "ADMIN"],
            required: true,
        },
        ownerEmail: { type: String, required: true },
        filters: { type: Schema.Types.Mixed, default: {} },
        metadata: { type: Schema.Types.Mixed, default: {} },
        filename: { type: String },
        filePath: { type: String },
        fileSize: { type: Number },
        error: { type: String },
        processedAt: { type: Date },
        expiresAt: {
            type: Date,
            default: () => {
                const d = getISTDate();
                d.setDate(d.getDate() + 7); // Default 7 days expiry
                return d;
            },
            index: true,
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
        id: false,
    }
);

GeneratedReportSchema.pre("validate", async function (next) {
    if (!this.id) {
        const { generateCustomId } = await import("@/utils/id.util");
        this.id = await generateCustomId("REP", "report");
    }
    next();
});

export const GeneratedReportModel: Model<GeneratedReportDocument> =
    mongoose.models.GeneratedReport ||
    mongoose.model<GeneratedReportDocument>("GeneratedReport", GeneratedReportSchema);
