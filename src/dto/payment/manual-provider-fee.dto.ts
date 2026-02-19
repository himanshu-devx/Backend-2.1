import { z } from "zod";

export const ManualProviderFeeSettlementSchema = z.object({
    date: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Expected YYYY-MM-DD")
        .optional(),
});

export type ManualProviderFeeSettlementDto = z.infer<typeof ManualProviderFeeSettlementSchema>;
