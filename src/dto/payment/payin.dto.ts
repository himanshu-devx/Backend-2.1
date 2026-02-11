import { z } from "zod";

export const InitiatePayinSchema = z.object({
    amount: z
        .number()
        .int()
        .min(1, "Amount must be at least 1"),

    orderId: z
        .string()
        .trim()
        .min(5, "Order ID must be at least 10 characters long")
        .max(25, "Order ID must be at most 25 characters long"),

    paymentMode: z.enum(["UPI", "QR", "INTENT"]),

    customerName: z
        .string()
        .trim()
        .min(3, "Customer name must be at least 3 characters long"),

    customerEmail: z
        .string()
        .trim()
        .email("Invalid email address"),

    customerPhone: z
        .string()
        .trim()
        .regex(/^[6-9]\d{9}$/, "Invalid Indian mobile number"),

    remarks: z
        .string()
        .trim()
        .max(200, "Remarks too long")
        .optional(),

    redirectUrl: z
        .string()
        .trim()
        .url("Invalid redirect URL")
        .optional(),
});

export type InitiatePayinDto = z.infer<typeof InitiatePayinSchema>;
