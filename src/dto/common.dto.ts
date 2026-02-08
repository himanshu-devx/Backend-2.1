// src/dto/merchant.dto.ts

import { z } from "zod";
export const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");


export const ListQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .default("1")
    .transform(Number)
    .pipe(z.number().int().min(1, "Page must be 1 or greater.")),
  limit: z
    .string()
    .optional()
    .default("10")
    .transform(Number)
    .pipe(z.number().int().min(1, "Limit must be 1 or greater.")),
  search: z.string().trim().optional(),
  sort: z.string().optional(), // e.g., "email,-createdAt"
});

export const TransactionListQuerySchema = ListQuerySchema.extend({
  category: z.enum(["PAYIN", "PAYOUT", "OTHER"]).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  merchantId: z.string().optional(),
  providerId: z.string().optional(),
  legalEntityId: z.string().optional(),
  entityId: z.string().optional(),
  entityType: z.string().optional(),
  orderId: z.string().optional(),
  providerRef: z.string().optional(),
  utr: z.string().optional(),
  flags: z.string().optional(), // comma-separated list of flags
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
});

export type ListQueryDTO = z.infer<typeof ListQuerySchema>;

export interface LoginMetadata {
  ipAddress: string;
  userAgent: string;
}
