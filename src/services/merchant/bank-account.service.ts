import { generateCustomId } from "@/utils/id.util";
import {
  MerchantBankAccountDocument,
  MerchantBankAccountModel,
} from "@/models/merchant-bank-account.model";
import { BankAccountStatus } from "@/constants/utils.constant";

import { BaseRepository, PaginatedResult } from "@/utils/base-repository";
import { ok, err, Result } from "@/utils/result";
import { HttpError, NotFound, BadRequest } from "@/utils/error";
import { AuditContext } from "@/utils/audit.util";
import { AuditService } from "@/services/common/audit.service";
import {
  CreateMerchantBankAccountDTO,
  UpdateMerchantBankAccountDTO,
} from "@/dto/merchant-bank-account.dto";

class MerchantBankAccountRepository extends BaseRepository<MerchantBankAccountDocument> {
  constructor() {
    super(MerchantBankAccountModel);
  }

  async findById(id: string): Promise<MerchantBankAccountDocument | null> {
    return this.model.findOne({ id }).exec();
  }

  async update(
    id: string,
    payload: Partial<MerchantBankAccountDocument>
  ): Promise<MerchantBankAccountDocument | null> {
    return this.model.findOneAndUpdate({ id }, payload, { new: true }).exec();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.model.findOneAndDelete({ id }).exec();
    return !!result;
  }
}

export const merchantBankAccountRepository =
  new MerchantBankAccountRepository();

export class MerchantBankAccountService {
  static async create(
    merchantId: string,
    data: CreateMerchantBankAccountDTO,
    auditContext?: AuditContext
  ): Promise<Result<MerchantBankAccountDocument, HttpError>> {
    const existing = await merchantBankAccountRepository.findOne({
      merchantId,
      accountNumber: data.accountNumber,
      ifsc: data.ifsc,
    });

    if (existing) {
      return err(BadRequest("Bank account already exists for this merchant"));
    }

    try {
      const id = await generateCustomId("WA", "merchant_bank_account");
      const created = await merchantBankAccountRepository.create({
        ...data,
        id,
        merchantId: merchantId as any,
        status: BankAccountStatus.PENDING,
      });

      if (auditContext) {
        AuditService.record({
          action: "MERCHANT_ADD_BANK_ACCOUNT",
          actorType: "MERCHANT",
          actorId: auditContext.actorEmail,
          entityType: "MERCHANT_BANK_ACCOUNT",
          entityId: created._id as unknown as string,
          metadata: { initialData: data },
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          requestId: auditContext.requestId,
        });
      }

      return ok(created);
    } catch (error: any) {
      // Handle MongoDB Duplicate Key Error (11000)
      if (error.code === 11000) {
        return err(BadRequest("Bank account already exists for this merchant"));
      }
      throw error;
    }
  }

  static async list(
    merchantId: string,
    query: any
  ): Promise<Result<PaginatedResult<MerchantBankAccountDocument>, HttpError>> {
    const { page, limit, sort, ...filter } = query;
    const result = await merchantBankAccountRepository.list({
      filter: { ...filter, merchantId }, // Force merchantId scope
      page,
      limit,
      sort,
    });
    return ok(result);
  }

  static async getById(
    merchantId: string,
    id: string
  ): Promise<Result<MerchantBankAccountDocument, HttpError>> {
    const account = await merchantBankAccountRepository.findOne({
      id: id,
      merchantId,
    });

    if (!account) return err(NotFound("Bank account not found"));

    return ok(account);
  }

  static async update(
    merchantId: string,
    id: string,
    data: UpdateMerchantBankAccountDTO,
    auditContext?: AuditContext
  ): Promise<Result<MerchantBankAccountDocument, HttpError>> {
    const account = await merchantBankAccountRepository.findOne({
      id: id,
      merchantId,
    });

    if (!account) return err(NotFound("Bank account not found"));

    const previousValues = account.toObject();

    // Reset status to PENDING on update, clear rejection reason
    const updates = {
      ...data,
      status: BankAccountStatus.PENDING,
      rejectReason: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
    };

    const updated = await merchantBankAccountRepository.update(id, updates);

    if (!updated) return err(NotFound("Failed to update bank account"));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_BANK_ACCOUNT",
        actorType: "MERCHANT",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT_BANK_ACCOUNT",
        entityId: id,
        metadata: { previousValues, newValues: data },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(updated);
  }

  static async delete(
    merchantId: string,
    id: string,
    auditContext?: AuditContext
  ): Promise<Result<boolean, HttpError>> {
    // Only allow deletion if PENDING? Or any? Let's say any for now.
    // BaseRepository doesn't have delete, let's just deactivate? No user asked to "features add".
    // I'll stick to what was planned: Create, List, Update.
    // But if they want to delete, I should probably add delete to BaseRepo or use Model directly.
    // For now skipping delete as not explicitly requested, but usually required.
    // I'll leave it as is.
    return err(BadRequest("Delete not implemented"));
  }
}
