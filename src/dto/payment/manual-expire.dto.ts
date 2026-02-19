import { z } from "zod";

export const ManualExpirePendingSchema = z.object({
    reason: z.string().trim().max(200, "Reason too long").optional(),
});

export type ManualExpirePendingDto = z.infer<typeof ManualExpirePendingSchema>;
