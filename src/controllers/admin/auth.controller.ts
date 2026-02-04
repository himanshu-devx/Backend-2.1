import type { Context } from "hono";
import { AdminService } from "@/services/admin/auth.service";
import { respond } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import { err } from "@/utils/result";
import { Unauthorized } from "@/utils/error";

import {
  CreateAdminDTO,
  LoginAdminDTO,
  UpdateAdminRoleDTO,
} from "@/dto/admin/admin.dto";
import { ListQueryDTO } from "@/dto/common.dto";
import { DashboardService } from "@/services/admin/dashboard.service";

export class AdminController {
  static async createAdmin(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as CreateAdminDTO;
    const result = await AdminService.createAdmin(body, ctx);
    return respond(c, result, { successStatus: 201 });
  }

  static async createSuperAdmin(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as CreateAdminDTO;
    const result = await AdminService.createSuperAdmin(body, ctx);
    return respond(c, result, { successStatus: 201 });
  }

  static async login(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as LoginAdminDTO;
    const result = await AdminService.login(body, ctx);
    return respond(c, result);
  }

  static async verifyOtp(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as any; // VerifyOtpDTO
    const result = await AdminService.verifyLoginOtp(body, ctx);
    return respond(c, result);
  }

  static async getAdminProfile(c: Context) {
    const adminId = c.req.param("id");
    const result = await AdminService.getAdminById(adminId);
    return respond(c, result);
  }

  static async getAdminList(c: Context) {
    const queryOptions = c.get("validatedQuery") as ListQueryDTO;
    const query = c.req.query();
    const result = await AdminService.getAdminList({
      ...queryOptions,
      role: query.role,
      status: query.status,
    } as any);
    return respond(c, result);
  }

  static async toggleAdminStatus(c: Context) {
    const ctx = getAuditContext(c);
    const adminId = c.req.param("id");
    const result = await AdminService.toggleAdminStatus(adminId, ctx);
    return respond(c, result);
  }

  static async updateAdminRole(c: Context) {
    const ctx = getAuditContext(c);
    const adminId = c.req.param("id");
    const body = c.get("validatedBody") as UpdateAdminRoleDTO;
    const result = await AdminService.updateAdminRole(
      adminId,
      body.newRole,
      ctx
    );
    return respond(c, result);
  }

  static async initiatePasswordReset(c: Context) {
    const ctx = getAuditContext(c);
    const { email } = c.get("validatedBody") as { email: string };
    const origin = c.req.header("origin");
    const result = await AdminService.initiatePasswordReset(email, origin, ctx);
    return respond(c, result, { successStatus: 202 });
  }

  static async confirmResetPassword(c: Context) {
    const ctx = getAuditContext(c);
    const { token, newPassword } = c.get("validatedBody") as {
      token: string;
      newPassword: string;
    };
    const result = await AdminService.confirmPasswordReset(
      token,
      newPassword,
      ctx
    );
    return respond(c, result);
  }

  static async updateIpWhitelist(c: Context) {
    const ctx = getAuditContext(c);
    const adminId = c.req.param("id");
    const body = c.get("validatedBody") as any; // UpdateAdminIpWhitelistDTO
    const result = await AdminService.updateIpWhitelist(adminId, body, ctx);
    return respond(c, result);
  }

  static async updateAdminProfile(c: Context) {
    const ctx = getAuditContext(c);
    const adminId = c.req.param("id"); // Target Admin ID
    const body = c.get("validatedBody") as any; // UpdateAdminProfileDTO
    const result = await AdminService.updateProfile(adminId, body, ctx);
    return respond(c, result);
  }
  static async updateOwnProfile(c: Context) {
    const ctx = getAuditContext(c);
    const userId = c.get("id");
    if (!userId) return respond(c, err(Unauthorized("Not authenticated")));

    const body = c.get("validatedBody") as any; // UpdateAdminProfileDTO
    const result = await AdminService.updateProfile(userId, body, ctx);
    return respond(c, result);
  }

  static async getDashboardStats(c: Context) {
    const { startDate, endDate, bucket } = c.req.query();
    const merchantId = c.req.queries("merchantId");
    const providerId = c.req.queries("providerId");
    const legalEntityId = c.req.queries("legalEntityId");

    // Explicitly cast bucket to expected literal type if present
    const bucketParam = bucket as "hourly" | "daily" | undefined;

    const result = await DashboardService.getStats(
      startDate,
      endDate,
      merchantId,
      providerId,
      legalEntityId,
      bucketParam
    );
    return respond(c, result);
  }

  static async onboardMerchant(c: Context) {
    const ctx = getAuditContext(c);
    const merchantId = c.req.param("id");
    const result = await AdminService.onboardMerchant(merchantId, ctx);
    return respond(c, result);
  }


}
