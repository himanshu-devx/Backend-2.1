import { z } from "zod";

export const CreateProviderSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["BANK", "GATEWAY"]),
  isActive: z.boolean().optional(),
  capabilities: z
    .object({
      payin: z.boolean().default(false),
      payout: z.boolean().default(false),
    })
    .optional(),
});

export const UpdateProviderSchema = z.object({
  displayName: z.string().min(1).optional(),
  type: z.enum(["BANK", "GATEWAY"]).optional(),
  isActive: z.boolean().optional(),
  capabilities: z
    .object({
      payin: z.boolean().optional(),
      payout: z.boolean().optional(),
    })
    .optional(),
});

export type CreateProviderDTO = z.infer<typeof CreateProviderSchema>;
export type UpdateProviderDTO = z.infer<typeof UpdateProviderSchema>;
