import { Context } from "hono";
import { MerchantBankAccountService } from "@/services/merchant/bank-account.service";
import { respond as handleResult } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import {
  CreateMerchantBankAccountDTO,
  UpdateMerchantBankAccountDTO,
} from "@/dto/merchant-bank-account.dto";

export class MerchantBankAccountController {
  static async create(c: Context) {
    const ctx = getAuditContext(c);
    const merchantId = c.get("id");

    const body = c.get("validatedBody") as CreateMerchantBankAccountDTO;
    const result = await MerchantBankAccountService.create(
      merchantId,
      body,
      ctx
    );
    return handleResult(c, result, { successStatus: 201 });
  }

  static async list(c: Context) {
    const merchantId = c.get("id");
    const query = c.req.query();
    const result = await MerchantBankAccountService.list(merchantId, query);
    return handleResult(c, result);
  }

  static async update(c: Context) {
    const ctx = getAuditContext(c);
    const merchantId = c.get("id");
    const id = c.req.param("id");
    const body = c.get("validatedBody") as UpdateMerchantBankAccountDTO;
    const result = await MerchantBankAccountService.update(
      merchantId,
      id,
      body,
      ctx
    );
    return handleResult(c, result);
  }
}
