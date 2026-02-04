import { MerchantBankAccountDocument } from "@/models/merchant-bank-account.model";
import { BankAccountStatus } from "@/constants/utils.constant";

import { merchantBankAccountRepository } from "@/services/merchant/bank-account.service"; // Reuse repo
import { ok, err, Result } from "@/utils/result";
import { HttpError, NotFound, BadRequest } from "@/utils/error";
import { AuditContext } from "@/utils/audit.util";
import { AuditService } from "@/services/common/audit.service";
import { getISTDate } from "@/utils/date.util";
import { PaginatedResult } from "@/utils/base-repository";

export class AdminMerchantBankAccountService {
  static async list(
    query: any
  ): Promise<Result<PaginatedResult<MerchantBankAccountDocument>, HttpError>> {
    const { page, limit, sort, ...filter } = query;
    const result = await merchantBankAccountRepository.list({
      filter, // Admin can filter by merchantId via query if needed
      page,
      limit,
      sort,
    });
    return ok(result);
  }

  static async updateStatus(
    id: string,
    status: BankAccountStatus,
    rejectReason: string | undefined,
    adminId: string,
    auditContext?: AuditContext
  ): Promise<Result<MerchantBankAccountDocument, HttpError>> {
    const account = await merchantBankAccountRepository.findOne({ id: id });
    if (!account) return err(NotFound("Bank account not found"));

    const previousValues = {
      status: account.status,
      rejectReason: account.rejectReason,
    };

    const updates: Partial<MerchantBankAccountDocument> = {
      status,
      approvedBy:
        status === BankAccountStatus.APPROVED ? (adminId as any) : undefined,
      approvedAt:
        status === BankAccountStatus.APPROVED ? getISTDate() : undefined,
      rejectReason:
        status === BankAccountStatus.REJECTED ? rejectReason : undefined,
    };

    const updated = await merchantBankAccountRepository.update(
      id,
      updates
    );

    if (!updated) return err(NotFound("Failed to update status"));

    if (auditContext) {
      AuditService.record({
        action: `ADMIN_${status}_BANK_ACCOUNT` as any,
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT_BANK_ACCOUNT",
        entityId: id,
        metadata: { previousValues, newValues: updates },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(updated);
  }

  static async toggleActive(
    id: string,
    isActive: boolean,
    auditContext?: AuditContext
  ): Promise<Result<MerchantBankAccountDocument, HttpError>> {
    const account = await merchantBankAccountRepository.findOne({ id: id });
    if (!account) return err(NotFound("Bank account not found"));

    const updated = await merchantBankAccountRepository.update(
      id,
      {
        isActive,
      }
    );

    if (!updated) return err(NotFound("Failed to update active status"));

    if (auditContext) {
      AuditService.record({
        action: "ADMIN_TOGGLE_BANK_ACCOUNT_ACTIVE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT_BANK_ACCOUNT",
        entityId: id,
        metadata: { previousIsActive: account.isActive, newIsActive: isActive },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(updated);
  }
}
