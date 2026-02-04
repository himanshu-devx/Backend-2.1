import { Context } from "hono";
import { ProviderLegalEntityService } from "@/services/provider/provider-legal-entity.service";
import { respond as handleResult } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import {
  CreateProviderLegalEntityDTO,
  UpdateProviderServiceConfigDTO,
  AddProviderFeeTierDTO,
  DeleteProviderFeeTierDTO,
} from "@/dto/provider-legal-entity.dto";

export class ProviderLegalEntityController {
  static async create(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as CreateProviderLegalEntityDTO;
    // Cast to any because DTO has strings for IDs but Model expects ObjectIds (Mongoose handles conversion)
    const result = await ProviderLegalEntityService.create(body as any, ctx);
    return handleResult(c, result, { successStatus: 201 });
  }

  static async list(c: Context) {
    const query = c.req.query();
    const result = await ProviderLegalEntityService.list(query);
    return handleResult(c, result);
  }

  static async getById(c: Context) {
    const id = c.req.param("id");
    const result = await ProviderLegalEntityService.getById(id);
    return handleResult(c, result);
  }

  static async updatePayinConfig(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as UpdateProviderServiceConfigDTO;
    const result = await ProviderLegalEntityService.updatePayinConfig(
      id,
      body,
      ctx
    );
    return handleResult(c, result);
  }

  static async addPayinFee(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as AddProviderFeeTierDTO;
    const result = await ProviderLegalEntityService.addPayinFeeTier(
      id,
      body,
      ctx
    );
    return handleResult(c, result);
  }

  static async deletePayinFee(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as DeleteProviderFeeTierDTO;
    const result = await ProviderLegalEntityService.deletePayinFeeTier(
      id,
      body,
      ctx
    );
    return handleResult(c, result);
  }

  static async updatePayoutConfig(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as UpdateProviderServiceConfigDTO;
    const result = await ProviderLegalEntityService.updatePayoutConfig(
      id,
      body,
      ctx
    );
    return handleResult(c, result);
  }

  static async addPayoutFee(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as AddProviderFeeTierDTO;
    const result = await ProviderLegalEntityService.addPayoutFeeTier(
      id,
      body,
      ctx
    );
    return handleResult(c, result);
  }

  static async deletePayoutFee(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") as DeleteProviderFeeTierDTO;
    const result = await ProviderLegalEntityService.deletePayoutFeeTier(
      id,
      body,
      ctx
    );
    return handleResult(c, result);
  }

  static async onboard(c: Context) {
    const id = c.req.param("id");
    const result = await ProviderLegalEntityService.onboard(id);
    return handleResult(c, result);
  }
}
