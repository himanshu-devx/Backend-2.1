import { z } from "zod";

export const InitiatePayoutSchema = z.object({
    amount: z.number().min(1, "Amount must be at least 1"),
    currency: z.string().default("INR"),
    orderId: z.string().min(1, "Order ID is required"),
    paymentMode: z.enum(["UPI", "NEFT", "RTGS", "IMPS"]),
    beneficiary: z.object({
        name: z.string().min(1, "Beneficiary name is required"),
        email: z.string().email().optional(),
        phone: z.string().optional(),

        // Banking details required for Payout
        accountNumber: z.string().min(1, "Account Number is required"),
        ifsc: z.string().min(1, "IFSC Code is required"),
        bankName: z.string().min(1, "Bank Name is required"),
    }),
    remarks: z.string().optional(), // For mock/testing: SUCCESS, PENDING, or FAILED
    hash: z.string().min(1, "Hash is required"),
});

export type InitiatePayoutDto = z.infer<typeof InitiatePayoutSchema>;
