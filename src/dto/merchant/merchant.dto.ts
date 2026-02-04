// src/dto/merchant.dto.ts

import { z } from "zod";
import { MERCHANT_ROLES } from "@/constants/users.constant";

const ZodMerchantRoleEnum = z.enum(
  Object.values(MERCHANT_ROLES) as [string, ...string[]]
);

export const RegisterMerchantSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  email: z.string().email("Invalid email format."),
  password: z.string().optional(),
});

export type RegisterMerchantDTO = z.infer<typeof RegisterMerchantSchema>;

export const LoginMerchantSchema = z.object({
  email: z.string().email("Invalid email format."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  deviceId: z.string().optional(),
});

export type LoginMerchantDTO = z.infer<typeof LoginMerchantSchema>;

export const VerifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  deviceId: z.string(),
});

export type VerifyOtpDTO = z.infer<typeof VerifyOtpSchema>;

export const UpdateMerchantRoleSchema = z.object({
  newRole: ZodMerchantRoleEnum,
});

export type UpdateMerchantRoleDTO = z.infer<typeof UpdateMerchantRoleSchema>;

// Update Panel IP Whitelist (Combined: IPs + Enable/Disable) - IPv4 Only
export const UpdatePanelIpWhitelistSchema = z.object({
  panelIpWhitelist: z
    .array(
      z
        .string()
        .ip({ version: "v4", message: "Only IPv4 addresses are allowed." })
    )
    .max(5, "Maximum 5 IP addresses allowed.")
    .optional(),
  isPanelIpWhitelistEnabled: z.boolean().optional(),
  payinIpWhitelist: z
    .array(
      z
        .string()
        .ip({ version: "v4", message: "Only IPv4 addresses are allowed." })
    )
    .max(5, "Maximum 5 IP addresses allowed.")
    .optional(),
  isPayinIpWhitelistEnabled: z.boolean().optional(),
  payoutIpWhitelist: z
    .array(
      z
        .string()
        .ip({ version: "v4", message: "Only IPv4 addresses are allowed." })
    )
    .max(5, "Maximum 5 IP addresses allowed.")
    .optional(),
  isPayoutIpWhitelistEnabled: z.boolean().optional(),
});
export type UpdatePanelIpWhitelistDTO = z.infer<
  typeof UpdatePanelIpWhitelistSchema
>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format."),
});
export type ForgotPasswordDTO = z.infer<typeof ForgotPasswordSchema>;

export const ConfirmResetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});
export type ConfirmResetPasswordDTO = z.infer<
  typeof ConfirmResetPasswordSchema
>;

export const FeeComponentSchema = z.object({
  flat: z.number().min(0),
  percentage: z.number().min(0),
  taxRate: z.number().min(0).default(18),
  strategy: z.enum(["SUM", "MAX"]).default("SUM"),
});

export const FeeTierSchema = z.object({
  fromAmount: z.number().min(0),
  toAmount: z.number().min(-1),
  charge: FeeComponentSchema,
});

export const UpdateServiceConfigSchema = z.object({
  isActive: z.boolean().optional(),
  tps: z.number().min(1).optional(),
  dailyLimit: z.number().min(0).optional(),
  accounts: z
    .object({
      holdAccountId: z.string().optional(),
      availableAccountId: z.string().optional(),
    })
    .optional(),
});

export type UpdateServiceConfigDTO = z.infer<typeof UpdateServiceConfigSchema>;

export const UpdateMerchantProfileSchema = z.object({
  displayName: z.string().min(2).optional(),
});

export type UpdateMerchantProfileDTO = z.infer<
  typeof UpdateMerchantProfileSchema
>;

export const ToggleApiSecretSchema = z.object({
  enabled: z.boolean(),
});

export const AddFeeTierSchema = FeeTierSchema;
export type AddFeeTierDTO = z.infer<typeof AddFeeTierSchema>;

export const DeleteFeeTierSchema = z.object({
  fromAmount: z.number(),
});
export type DeleteFeeTierDTO = z.infer<typeof DeleteFeeTierSchema>;

export const UpdateRoutingSchema = z.object({
  payinRouting: z
    .object({
      providerId: z.string().optional(),
      legalEntityId: z.string().optional(),
    })
    .optional(),
  payoutRouting: z
    .object({
      providerId: z.string().optional(),
      legalEntityId: z.string().optional(),
    })
    .optional(),
});
export type UpdateRoutingDTO = z.infer<typeof UpdateRoutingSchema>;
