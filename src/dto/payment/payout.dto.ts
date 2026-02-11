import { z } from "zod";

export const InitiatePayoutSchema = z.object({
    amount: z
        .number()
        .int()
        .min(1, "Amount must be at least 1"),

    orderId: z
        .string()
        .trim()
        .min(5, "Order ID must be at least 10 characters long")
        .max(25, "Order ID must be at most 25 characters long"),

    paymentMode: z.enum(["UPI", "NEFT", "RTGS", "IMPS"]),

    beneficiaryName: z
        .string()
        .trim()
        .min(3, "Beneficiary name must be at least 3 characters long"),

    beneficiaryAccountNumber: z
        .string()
        .trim()
        .min(1, "Account Number is required"),

    beneficiaryIfsc: z
        .string()
        .transform(v => v.toUpperCase().trim())
        .pipe(
            z
                .string()
                .length(11, "IFSC must be exactly 11 characters")
                .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC format")
        ),

    beneficiaryBankName: z
        .string()
        .trim()
        .min(3, "Bank Name must be at least 3 characters long"),

    beneficiaryPhone: z
        .string()
        .trim()
        .regex(/^[6-9]\d{9}$/, "Invalid Indian mobile number")
        .optional(),

    remarks: z
        .string()
        .trim()
        .max(100, "Remarks too long")
        .optional(),
});

export type InitiatePayoutDto = z.infer<typeof InitiatePayoutSchema>;
