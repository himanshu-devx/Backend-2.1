import { z } from "zod";

export const ManualStatusSyncSchema = z.object({
    transactionId: z
        .string()
        .trim()
        .min(5, "Transaction ID must be at least 5 characters long"),
    confirm: z.boolean().optional().default(false),
});

export type ManualStatusSyncDto = z.infer<typeof ManualStatusSyncSchema>;
