import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import argon2 from "argon2";
import { ADMIN_ROLES, AdminRoleType } from "@/constants/users.constant";
import { getISTDate } from "@/utils/date.util";

export interface AdminDocument extends Document {
  id: string; // ADM-{seq} or USERID
  name: string;
  displayName: string;
  email: string;
  password: string;
  role: AdminRoleType;
  status: boolean;
  panelIpWhitelist: string[];
  isPanelIpWhitelistEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidate: string): Promise<boolean>;
}

const AdminSchema = new Schema<AdminDocument>(
  {
    id: { type: String, unique: true, required: true, index: true },
    name: { type: String, required: true },
    displayName: { type: String, trim: true },
    email: { type: String, required: true, unique: true },
    // select: false -> never return hash by default
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: Object.values(ADMIN_ROLES),
      default: ADMIN_ROLES.ADMIN,
    },
    status: { type: Boolean, default: true },
    panelIpWhitelist: { type: [String], default: [] },
    isPanelIpWhitelistEnabled: { type: Boolean, default: false },
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

AdminSchema.pre("save", async function (next) {
  if (!this.id) {
    const { generateCustomId } = await import("@/utils/id.util");
    this.id = await generateCustomId("ADM", "admin");
  }
  if (!this.displayName && this.name) {
    this.displayName = this.name;
  }
  next();
});

/* ---------------------------
   Indexes
   --------------------------- */
AdminSchema.index({ status: 1 });
AdminSchema.index({ role: 1 });
AdminSchema.index({ createdAt: -1 });

// Argon2 options (argon2id is recommended)
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  // you can tune these as needed; defaults are generally fine:
  // memoryCost: 19456,
  // timeCost: 2,
  // parallelism: 1,
};

// Hash password before save
AdminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    this.password = await argon2.hash(this.password, ARGON2_OPTIONS);
    next();
  } catch (err) {
    next(err as Error);
  }
});

// Instance method to compare passwords
AdminSchema.methods.comparePassword = function (candidate: string) {
  return argon2.verify(this.password, candidate);
};

export const AdminModel: Model<AdminDocument> =
  mongoose.models.Admin || mongoose.model<AdminDocument>("Admin", AdminSchema);
