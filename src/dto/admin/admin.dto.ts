// src/dto/admin.dto.ts

import { z } from "zod";
import { ADMIN_ROLES } from "@/constants/users.constant";
import { ListQuerySchema, DateStringSchema } from "@/dto/common.dto";

export const ListLoginHistorySchema = ListQuerySchema.extend({
  userId: z.string().optional(),
  userType: z.string().optional(),
  email: z.string().optional(),
  status: z.string().optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
});
export type ListLoginHistoryDTO = z.infer<typeof ListLoginHistorySchema>;

const ZodAdminRoleEnum = z.enum(
  Object.values(ADMIN_ROLES) as [string, ...string[]]
);

export const CreateAdminSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  email: z.string().email("Invalid email format."),
  password: z.string().optional(),
  role: ZodAdminRoleEnum.optional().default(ADMIN_ROLES.SUPPORT),
});

export type CreateAdminDTO = z.infer<typeof CreateAdminSchema>;

export const LoginAdminSchema = z.object({
  email: z.string().email("Invalid email format."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  deviceId: z.string().optional(),
});
export type LoginAdminDTO = z.infer<typeof LoginAdminSchema>;

export const VerifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  deviceId: z.string(),
});
export type VerifyOtpDTO = z.infer<typeof VerifyOtpSchema>;

export const UpdateAdminRoleSchema = z.object({
  newRole: ZodAdminRoleEnum,
});

export type UpdateAdminRoleDTO = z.infer<typeof UpdateAdminRoleSchema>;

// Update Panel IP Whitelist (Combined: IPs + Enable/Disable)
export const UpdatePanelIpWhitelistSchema = z.object({
  panelIpWhitelist: z
    .array(z.string().ip("Invalid IP address format."))
    .max(5, "Maximum 5 IP addresses allowed."),
  isPanelIpWhitelistEnabled: z.boolean(),
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

// Update Own Profile
export const UpdateAdminProfileSchema = z.object({
  displayName: z.string().min(2).optional(),
  password: z.string().min(6).optional(),
});
export type UpdateAdminProfileDTO = z.infer<typeof UpdateAdminProfileSchema>;

export const UpdateMerchantRoutingSchema = z.object({
  type: z.enum(["PAYIN", "PAYOUT"]),
  routing: z.object({
    providerId: z.string().min(1, "Provider ID is required"),
    legalEntityId: z.string().min(1, "Legal Entity ID is required"),
  }),
});
export type UpdateMerchantRoutingDTO = z.infer<
  typeof UpdateMerchantRoutingSchema
>;
