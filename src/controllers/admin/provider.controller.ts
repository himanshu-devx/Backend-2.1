import { Context } from "hono";
import { ProviderService } from "@/services/provider/provider.service";
import { respond as handleResult } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import { CreateProviderDTO, UpdateProviderDTO } from "@/dto/provider.dto";

export class ProviderController {
  static async create(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as CreateProviderDTO;
    const result = await ProviderService.create(body, ctx);
    return handleResult(c, result, { successStatus: 201 });
  }

  static async list(c: Context) {
    const query = c.req.query();
    const result = await ProviderService.list(query);
    return handleResult(c, result);
  }

  static async getById(c: Context) {
    const id = c.req.param("id");
    const result = await ProviderService.getById(id);
    return handleResult(c, result);
  }

  static async update(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as UpdateProviderDTO;
    const result = await ProviderService.update(id, body, ctx);
    return handleResult(c, result);
  }
}
