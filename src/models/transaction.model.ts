import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { generateCustomId } from "@/utils/id.util";
import { ENV } from "@/config/env";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/utils/secret.util";

import {
  TransactionPartyType,
  TransactionType,
  TransactionFlag,
} from "@/constants/transaction.constant";

export enum TransactionStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
  REVERSED = "REVERSED",
}

export interface FeeDetail {
  flat: number;
  percentage: number;
  tax: number;
  total: number;
}

export interface TransactionFee {
  merchantFees?: FeeDetail;
  providerFees?: FeeDetail;
}

export interface TransactionParty {
  type?: TransactionPartyType | string;
  name?: string;
  email?: string;
  phone?: string;
  accountNumber?: string;
  bankName?: string;
  ifscCode?: string;
  upiId?: string;
  bankAccountId?: string;
  [key: string]: any;
}

export interface TransactionEvent {
  type: string;
  message?: string;
  timestamp: Date;
  payload?: any;
}

export interface TransactionDocument extends Document {
  id: string; // TXN-{seq}

  // Legacy/Specific ID references (Optional but kept for index/compatibility)
  merchantId?: string;
  providerId?: string;
  legalEntityId?: string;
  providerLegalEntityId?: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  netAmount: number;
  currency: string;

  orderId: string; // System generated unique order ID
  providerRef?: string; // Renamed from externalOrderId
  // referenceId removed
  utr?: string;
  paymentMode?: string;
  remarks?: string;

  // Generic Counterparty
  party: TransactionParty;

  fees: TransactionFee;

  error?: string;

  meta: {
    ip?: string;
    [key: string]: any;
  };
  events: TransactionEvent[];
  flags?: TransactionFlag[];

  createdAt: Date;
  updatedAt: Date;

  // Backdating
  isBackDated?: boolean;
  insertedDate?: Date;

  // Virtuals
  narration: string;
}

const MAX_TRANSACTION_EVENTS = 50;

const TransactionSchema = new Schema<TransactionDocument>(
  {
    id: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    // Specific IDs (Optional)
    merchantId: { type: String, index: true },
    providerId: { type: String, index: true },
    legalEntityId: { type: String, index: true },
    providerLegalEntityId: { type: String, index: true },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(TransactionStatus),
      default: TransactionStatus.PENDING,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    netAmount: {
      // if payin amount-mercahntfee , if payout amount +mercahntfees
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
      uppercase: true,
    },
    orderId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    providerRef: {
      type: String,
      required: false,
      index: true,
    },
    utr: {
      type: String,
      index: true,
    },
    paymentMode: {
      type: String,
    },
    remarks: {
      type: String,
    },

    // Backdated Info
    isBackDated: {
      type: Boolean,
      default: false,
    },
    insertedDate: {
      type: Date,
    },

    // Generic Party
    party: {
      type: new Schema(
        {
          type: {
            type: String,
            enum: Object.values(TransactionPartyType),
          },
          name: {
            type: String,
            get: (v: any) => (ENV.ENCRYPT_PII ? decryptSecret(v) ?? v : v),
            set: (v: any) => {
              if (!ENV.ENCRYPT_PII) return v;
              if (!v) return v;
              return isEncryptedSecret(v) ? v : encryptSecret(String(v));
            },
          },
          email: {
            type: String,
            get: (v: any) => (ENV.ENCRYPT_PII ? decryptSecret(v) ?? v : v),
            set: (v: any) => {
              if (!ENV.ENCRYPT_PII) return v;
              if (!v) return v;
              return isEncryptedSecret(v) ? v : encryptSecret(String(v));
            },
          },
          phone: {
            type: String,
            get: (v: any) => (ENV.ENCRYPT_PII ? decryptSecret(v) ?? v : v),
            set: (v: any) => {
              if (!ENV.ENCRYPT_PII) return v;
              if (!v) return v;
              return isEncryptedSecret(v) ? v : encryptSecret(String(v));
            },
          },
          accountNumber: {
            type: String,
            get: (v: any) => (ENV.ENCRYPT_PII ? decryptSecret(v) ?? v : v),
            set: (v: any) => {
              if (!ENV.ENCRYPT_PII) return v;
              if (!v) return v;
              return isEncryptedSecret(v) ? v : encryptSecret(String(v));
            },
          },
          bankName: String,
          ifscCode: {
            type: String,
            get: (v: any) => (ENV.ENCRYPT_PII ? decryptSecret(v) ?? v : v),
            set: (v: any) => {
              if (!ENV.ENCRYPT_PII) return v;
              if (!v) return v;
              return isEncryptedSecret(v) ? v : encryptSecret(String(v));
            },
          },
          upiId: {
            type: String,
            get: (v: any) => (ENV.ENCRYPT_PII ? decryptSecret(v) ?? v : v),
            set: (v: any) => {
              if (!ENV.ENCRYPT_PII) return v;
              if (!v) return v;
              return isEncryptedSecret(v) ? v : encryptSecret(String(v));
            },
          },
          bankAccountId: {
            type: String,
            get: (v: any) => (ENV.ENCRYPT_PII ? decryptSecret(v) ?? v : v),
            set: (v: any) => {
              if (!ENV.ENCRYPT_PII) return v;
              if (!v) return v;
              return isEncryptedSecret(v) ? v : encryptSecret(String(v));
            },
          },
        },
        { _id: false }
      ),
    },

    fees: {
      type: new Schema(
        {
          merchantFees: {
            flat: { type: Number, default: 0 },
            percentage: { type: Number, default: 0 },
            tax: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
          },
          providerFees: {
            flat: { type: Number, default: 0 },
            percentage: { type: Number, default: 0 },
            tax: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
          },
        },
        { _id: false }
      ),
      default: {},
    },

    error: {
      type: String,
    },

    meta: {
      type: new Schema(
        {
          ip: { type: String },
        },
        { strict: false, _id: false }
      ),
      default: {},
    },
    events: [
      {
        type: { type: String, required: true },
        message: { type: String },
        timestamp: { type: Date, default: Date.now },
        payload: { type: Schema.Types.Mixed },
        _id: false,
      },
    ],
    flags: {
      type: [String],
      enum: Object.values(TransactionFlag),
      default: [],
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      getters: true,
      transform: function (doc: any, ret: any) {
        delete ret._id;
        delete ret.__v;
      },
    },
    toObject: { virtuals: true, getters: true },
    id: false,
    }
);

// Virtual for 'narration' (dynamic)
TransactionSchema.virtual("narration").get(function (
  this: TransactionDocument
) {
  return [this.type, this.paymentMode, this.utr]
    .filter(Boolean)
    .join("/");
});


// Indexes
TransactionSchema.index(
  { providerId: 1, providerRef: 1 },
  { unique: true, partialFilterExpression: { providerRef: { $exists: true } } }
);
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ merchantId: 1, orderId: 1 });
TransactionSchema.index({ merchantId: 1, status: 1, updatedAt: -1 });

// Use pre-validate to ensure ID is set before required check
TransactionSchema.pre(
  "validate",
  async function (this: TransactionDocument, next) {
    if (!this.id) {
      const rawPrefix = ENV.APP_BRAND_PREFIX || ENV.APP_BRAND_NAME || "TXN";
      let prefix = rawPrefix.replace(/[^a-zA-Z]/g, "").substring(0, 4).toUpperCase();

      if (!prefix) prefix = "TXN";

      this.id = await generateCustomId(prefix, "transaction");
    }
    if (!this.orderId) {
      this.orderId = await generateCustomId("ORD", "order");
    }
    next();
  }
);

TransactionSchema.pre(
  "save",
  function (this: TransactionDocument, next) {
    if (Array.isArray(this.events) && this.events.length > MAX_TRANSACTION_EVENTS) {
      this.events = this.events.slice(-MAX_TRANSACTION_EVENTS);
    }
    next();
  }
);

export const TransactionModel: Model<TransactionDocument> =
  mongoose.models.Transaction ||
  mongoose.model<TransactionDocument>("Transaction", TransactionSchema);
