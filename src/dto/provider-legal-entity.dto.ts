import { z } from "zod";
import { FeeTierSchema } from "@/dto/merchant/merchant.dto";

export const CreateProviderLegalEntitySchema = z.object({
  providerId: z.string().min(1, "Provider ID is required"),
  legalEntityId: z.string().min(1, "Legal Entity ID is required"),
  config: z
    .object({
      apiKeyEncrypted: z.string().optional(),
      apiSecretEncrypted: z.string().optional(),
      webhookSecretEncrypted: z.string().optional(),
    })
    .optional(),
  payin: z.any().optional(), // Can refine later
  payout: z.any().optional(),
  isActive: z.boolean().optional(),
});

export type CreateProviderLegalEntityDTO = z.infer<
  typeof CreateProviderLegalEntitySchema
>;

export const UpdateProviderServiceConfigSchema = z.object({
  isActive: z.boolean().optional(),
  tps: z.number().min(1).optional(),
  dailyLimit: z.number().min(0).optional(),
  accounts: z
    .object({
      collectionEscrowId: z.string().optional(),
      payoutEscrowId: z.string().optional(),
      commissionAccountId: z.string().optional(),
      providerFeeAccountId: z.string().optional(),
    })
    .optional(),
});

export type UpdateProviderServiceConfigDTO = z.infer<
  typeof UpdateProviderServiceConfigSchema
>;

export const AddProviderFeeTierSchema = FeeTierSchema;
export type AddProviderFeeTierDTO = z.infer<typeof AddProviderFeeTierSchema>;

export const DeleteProviderFeeTierSchema = z.object({
  fromAmount: z.number(),
});
export type DeleteProviderFeeTierDTO = z.infer<
  typeof DeleteProviderFeeTierSchema
>;
