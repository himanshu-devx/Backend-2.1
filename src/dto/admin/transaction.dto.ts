import { z } from "zod";

export const ReverseTransactionSchema = z.object({
  ledgerEntryId: z.string().optional(),
  reason: z.string().trim().max(200).optional(),
});

export type ReverseTransactionDTO = z.infer<typeof ReverseTransactionSchema>;

export const ReverseLedgerEntriesSchema = z.object({
  ledgerEntryIds: z.array(z.string()).min(1).optional(),
  includePrimary: z.boolean().optional().default(true),
  includeManual: z.boolean().optional().default(true),
  reason: z.string().trim().max(200).optional(),
  dryRun: z.boolean().optional().default(false),
});

export type ReverseLedgerEntriesDTO = z.infer<typeof ReverseLedgerEntriesSchema>;

export const AdminTransactionActionSchema = z.object({
  reason: z.string().trim().max(200).optional(),
  confirm: z.boolean().optional().default(false),
});

export type AdminTransactionActionDTO = z.infer<typeof AdminTransactionActionSchema>;
