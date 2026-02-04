import { z } from "zod";

export const InitiatePayinSchema = z.object({
    amount: z.number().min(1, "Amount must be at least 1"),
    currency: z.string().default("INR"),
    orderId: z.string().min(1, "Order ID is required"),
    customer: z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
    }),
    paymentMode: z.enum(["UPI", "QR"]),
    remarks: z.string().optional(), // For mock/testing: SUCCESS, PENDING, or FAILED
    hash: z.string().min(1, "Hash is required"),
    redirectUrl: z.string().url().optional(),
});

export type InitiatePayinDto = z.infer<typeof InitiatePayinSchema>;
