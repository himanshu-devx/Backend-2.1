import { z } from "zod";

export const ManualStatusUpdateSchema = z.object({
    orderId: z
        .string()
        .trim()
        .min(5, "Order ID must be at least 5 characters long")
        .max(25, "Order ID must be at most 25 characters long"),
    status: z.enum(["SUCCESS", "FAILED"]),
    utr: z.string().trim().min(3).max(50).optional(),
    providerTransactionId: z.string().trim().min(3).max(50).optional(),
    providerMsg: z.string().trim().max(200).optional(),
    reason: z.string().trim().max(200, "Reason too long").optional(),
});

export type ManualStatusUpdateDto = z.infer<typeof ManualStatusUpdateSchema>;
