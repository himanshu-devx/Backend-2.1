import { z } from "zod";

export const CreateLegalEntitySchema = z.object({
  name: z.string().min(1),
  identifier: z.string().min(1),
  gstin: z.string().optional(),
  bankAccount: z
    .object({
      accountNumber: z.string(),
      ifsc: z.string(),
      bankName: z.string(),
      beneficiaryName: z.string(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

export const UpdateLegalEntitySchema = z.object({
  name: z.string().min(1).optional(),
  identifier: z.string().min(1).optional(),
  gstin: z.string().optional(),
  bankAccount: z
    .object({
      accountNumber: z.string(),
      ifsc: z.string(),
      bankName: z.string(),
      beneficiaryName: z.string(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

export type CreateLegalEntityDTO = z.infer<typeof CreateLegalEntitySchema>;
export type UpdateLegalEntityDTO = z.infer<typeof UpdateLegalEntitySchema>;
