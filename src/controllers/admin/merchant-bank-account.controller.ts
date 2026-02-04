import { Context } from "hono";
import { AdminMerchantBankAccountService } from "@/services/admin/merchant-bank-account.service";
import { respond as handleResult } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import {
  UpdateMerchantBankAccountStatusDTO,
  ToggleMerchantBankAccountActiveDTO,
} from "@/dto/merchant-bank-account.dto";

export class AdminMerchantBankAccountController {
  static async list(c: Context) {
    const query = c.req.query();
    const result = await AdminMerchantBankAccountService.list(query);
    return handleResult(c, result);
  }

  static async updateStatus(c: Context) {
    const ctx = getAuditContext(c);
    const adminId = c.get("id");
    const id = c.req.param("id");
    const body = c.get("validatedBody") as UpdateMerchantBankAccountStatusDTO;
    const result = await AdminMerchantBankAccountService.updateStatus(
      id,
      body.status,
      body.rejectReason,
      adminId,
      ctx
    );
    return handleResult(c, result);
  }

  static async toggleActive(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as ToggleMerchantBankAccountActiveDTO;
    const result = await AdminMerchantBankAccountService.toggleActive(
      id,
      body.isActive,
      ctx
    );
    return handleResult(c, result);
  }
}
