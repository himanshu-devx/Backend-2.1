import { z } from "zod";

export const ReverseTransactionSchema = z.object({
  ledgerEntryId: z.string().optional(),
  reason: z.string().trim().max(200).optional(),
});

export type ReverseTransactionDTO = z.infer<typeof ReverseTransactionSchema>;
