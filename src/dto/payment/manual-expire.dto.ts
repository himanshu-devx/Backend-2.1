import { z } from "zod";

export const ManualExpirePendingSchema = z.object({
    date: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Expected YYYY-MM-DD")
        .optional(),
    reason: z.string().trim().max(200, "Reason too long").optional(),
});

export type ManualExpirePendingDto = z.infer<typeof ManualExpirePendingSchema>;
