import { z } from "zod";
import { ListQuerySchema } from "@/dto/common.dto";
import { BankAccountStatus } from "@/constants/utils.constant";

// --- Merchant Side DTOs ---

export const CreateMerchantBankAccountSchema = z.object({
  accountNumber: z.string().min(5, "Account number too short"),
  ifsc: z.string().length(11, "IFSC must be 11 characters"),
  bankName: z.string().min(2, "Bank name required"),
  beneficiaryName: z.string().min(2, "Beneficiary name required"),
});

export type CreateMerchantBankAccountDTO = z.infer<
  typeof CreateMerchantBankAccountSchema
>;

export const UpdateMerchantBankAccountSchema =
  CreateMerchantBankAccountSchema.partial();

export type UpdateMerchantBankAccountDTO = z.infer<
  typeof UpdateMerchantBankAccountSchema
>;

// --- Admin Side DTOs ---

export const ListMerchantBankAccountSchema = ListQuerySchema.extend({
  merchantId: z.string().optional(),
  status: z.nativeEnum(BankAccountStatus).optional(),
});

export type ListMerchantBankAccountDTO = z.infer<
  typeof ListMerchantBankAccountSchema
>;

export const UpdateMerchantBankAccountStatusSchema = z.object({
  status: z.enum([BankAccountStatus.APPROVED, BankAccountStatus.REJECTED]),
  rejectReason: z.string().optional(),
});
// .refine((data) => {
//   if (data.status === BankAccountStatus.REJECTED && !data.rejectReason) {
//     return false;
//   }
//   return true;
// }, {
//   message: "Reject reason is required when status is REJECTED",
//   path: ["rejectReason"],
// });

export type UpdateMerchantBankAccountStatusDTO = z.infer<
  typeof UpdateMerchantBankAccountStatusSchema
>;

export const ToggleMerchantBankAccountActiveSchema = z.object({
  isActive: z.boolean(),
});

export type ToggleMerchantBankAccountActiveDTO = z.infer<
  typeof ToggleMerchantBankAccountActiveSchema
>;
