import { z } from "zod";
import {
  ENTITY_ACCOUNT_TYPE,
  ENTITY_TYPE,
} from "@/constants/ledger.constant";
import {
  TransactionPartyType,
  TransactionType,
} from "@/constants/transaction.constant";

const ENTITY_TYPES = Object.values(ENTITY_TYPE) as [string, ...string[]];
const ACCOUNT_PURPOSES = Object.values(
  ENTITY_ACCOUNT_TYPE
) as [string, ...string[]];
const TRANSACTION_TYPES = Object.values(
  TransactionType
) as [string, ...string[]];
const PARTY_TYPES = Object.values(
  TransactionPartyType
) as [string, ...string[]];

export const LedgerAccountRefSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    entityType: z.enum(ENTITY_TYPES).optional(),
    entityId: z.string().min(1).optional(),
    purpose: z.enum(ACCOUNT_PURPOSES).optional(),
    world: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const hasAccountId = !!data.accountId;
    const hasEntityRef = !!data.entityType && !!data.entityId && !!data.purpose;
    const isWorld = !!data.world;

    if (!hasAccountId && !hasEntityRef && !isWorld) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Account reference must include accountId, entityType+entityId+purpose, or world=true.",
      });
    }
  });

export const TransactionPartySchema = z
  .object({
    type: z.enum(PARTY_TYPES).optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    ifscCode: z.string().optional(),
    upiId: z.string().optional(),
    bankAccountId: z.string().optional(),
  })
  .passthrough();

export const AccountDetailsSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    ifscCode: z.string().optional(),
    upiId: z.string().optional(),
  })
  .passthrough();

export const CreateLedgerTransferSchema = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  amount: z.number().positive(),
  currency: z.string().optional().default("INR"),
  narration: z.string().optional(),
  remarks: z.string().optional(),
  paymentMode: z.string().optional(),
  utr: z.string().optional(),
  orderId: z.string().optional(),
  valueDate: z.string().optional(),
  isBackDated: z.boolean().optional(),
  status: z.enum(["POSTED", "PENDING"]).optional().default("POSTED"),
  idempotencyKey: z.string().optional(),
  correlationId: z.string().optional(),
  externalRef: z.string().optional(),
  merchantId: z.string().optional(),
  providerId: z.string().optional(),
  legalEntityId: z.string().optional(),
  providerLegalEntityId: z.string().optional(),
  from: LedgerAccountRefSchema,
  to: LedgerAccountRefSchema,
  metadata: z.record(z.any()).optional(),
  party: TransactionPartySchema.optional(),
  fromDetails: AccountDetailsSchema.optional(),
  toDetails: AccountDetailsSchema.optional(),
});

export type CreateLedgerTransferDTO = z.infer<
  typeof CreateLedgerTransferSchema
>;
export type LedgerAccountRefDTO = z.infer<typeof LedgerAccountRefSchema>;
