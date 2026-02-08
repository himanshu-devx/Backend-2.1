import { Context } from "hono";
import { MerchantManagementService } from "@/services/admin/merchant-management.service";
import { AdminMerchantBankAccountService } from "@/services/admin/merchant-bank-account.service";
import { respond } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import {
  UpdateMerchantProfileDTO,
  UpdateServiceConfigDTO,
  AddFeeTierDTO,
  DeleteFeeTierDTO,
  UpdatePanelIpWhitelistDTO,
  ToggleApiSecretSchema,
  UpdateRoutingDTO,
} from "@/dto/merchant/merchant.dto";

export class MerchantManagementController {
  static async getMerchantList(c: Context) {
    const query = c.req.query();
    const result = await MerchantManagementService.getMerchantList({
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 10,
      search: query.search || "",
      sort: query.sort || "-createdAt",
      status: query.status,
    });
    return respond(c, result);
  }

  static async getMerchantProfile(c: Context) {
    const id = c.req.param("id");
    const result = await MerchantManagementService.getMerchantById(id);
    return respond(c, result);
  }

  static async toggleMerchantStatus(c: Context) {
    const id = c.req.param("id");
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.toggleMerchantStatus(
      id,
      auditContext
    );
    return respond(c, result);
  }

  static async updateIpWhitelist(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<UpdatePanelIpWhitelistDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.updateIpWhitelist(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async updateProfile(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<UpdateMerchantProfileDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.updateProfile(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async updatePayinConfig(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<UpdateServiceConfigDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.updatePayinConfig(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async updatePayoutConfig(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<UpdateServiceConfigDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.updatePayoutConfig(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async addPayinFee(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<AddFeeTierDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.addPayinFeeTier(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async deletePayinFee(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<DeleteFeeTierDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.deletePayinFeeTier(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async addPayoutFee(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<AddFeeTierDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.addPayoutFeeTier(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async deletePayoutFee(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<DeleteFeeTierDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.deletePayoutFeeTier(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async updateRouting(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<UpdateRoutingDTO>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.updateRouting(
      id,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async rotateApiSecret(c: Context) {
    const id = c.req.param("id");
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.rotateApiSecret(
      id,
      auditContext
    );
    return respond(c, result);
  }

  static async getApiSecret(c: Context) {
    const id = c.req.param("id");
    const result = await MerchantManagementService.getApiSecret(id);
    return respond(c, result);
  }

  static async toggleApiSecret(c: Context) {
    const id = c.req.param("id");
    const body = await c.req.json<{ enabled: boolean }>();
    const auditContext = getAuditContext(c);
    const result = await MerchantManagementService.toggleApiSecret(
      id,
      body.enabled,
      auditContext
    );
    return respond(c, result);
  }
  static async getBankAccounts(c: Context) {
    const id = c.req.param("id");
    const result = await AdminMerchantBankAccountService.list({
      merchantId: id,
    });
    return respond(c, result);
  }


  static async getMerchantActivity(c: Context) {
    const id = c.req.param("id");
    const result = await MerchantManagementService.getMerchantActivity(id);
    return respond(c, result);
  }
}
