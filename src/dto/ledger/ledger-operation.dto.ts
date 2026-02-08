import { z } from "zod";
import {
  LEDGER_OPERATION,
} from "@/constants/ledger-operations.constant";

const OPERATIONS = Object.values(LEDGER_OPERATION) as [string, ...string[]];

export const CreateLedgerOperationSchema = z.object({
  operation: z.enum(OPERATIONS),
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
  accountType: z.enum(["PAYIN", "PAYOUT"]).optional(),
  targetAccountType: z.enum(["PAYIN", "PAYOUT"]).optional(),
  counterparty: z.enum(["WORLD", "INCOME"]).optional(),
  accountId: z.string().optional(),
  bankAccountId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  fromDetails: z.record(z.any()).optional(),
  toDetails: z.record(z.any()).optional(),
});

export type CreateLedgerOperationDTO = z.infer<
  typeof CreateLedgerOperationSchema
>;
