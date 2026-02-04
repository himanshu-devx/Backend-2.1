// src/middlewares/panel-ip-whitelist.middleware.ts

import { Context, MiddlewareHandler, Next } from "hono";
import { AdminModel } from "@/models/admin.model";
import { MerchantModel } from "@/models/merchant.model";
import { Forbidden } from "@/utils/error";
import { ADMIN_ROLES } from "@/constants/users.constant";
import { ENV } from "@/config/env";
import { AuditService } from "@/services/common/audit.service";
import { LoginHistoryService } from "@/services/common/login-history.service";
import { ActorType, LoginStatus } from "@/models/login-history.model";
import { getAuditContext } from "@/utils/audit.util";
import { AdminService } from "@/services/admin/auth.service";
import { MerchantManagementService } from "@/services/admin/merchant-management.service";
import { isOk, Result } from "@/utils/result";

export const panelIpWhitelistMiddleware: MiddlewareHandler = async (
  c: Context,
  next: Next
) => {
  // Get audit context with properly extracted IP and other data
  const auditContext = getAuditContext(c);

  const userId = auditContext.actorId;
  const role = c.get("role") as string | undefined;
  const email = auditContext.actorEmail;

  // Skip if no user ID or role (unauthenticated requests, health checks, auth endpoints)
  if (!userId || !role) {
    return next();
  }

  // Use IP from audit context (properly validated IPv4)
  const clientIp = auditContext.ipAddress || "unknown";

  let isPanelIpWhitelistEnabled = false;
  let panelIpWhitelist: string[] = [];
  let userName: string | undefined;

  // Check if user is SUPER_ADMIN - use ENV variables
  if (role === ADMIN_ROLES.SUPER_ADMIN) {
    isPanelIpWhitelistEnabled = ENV.SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED;
    panelIpWhitelist = ENV.SUPER_ADMIN_IPS
      ? ENV.SUPER_ADMIN_IPS.split(",").map((ip) => ip.trim())
      : [];
  } else {
    // For other roles, fetch via services (which use Redis caching)
    let result: Result<any, any>;

    if (Object.values(ADMIN_ROLES).includes(role as any)) {
      result = await AdminService.getAdminById(userId);
    } else {
      result = await MerchantManagementService.getMerchantById(userId);
    }

    if (isOk(result)) {
      const user = result.value as any;
      isPanelIpWhitelistEnabled = user.isPanelIpWhitelistEnabled;
      panelIpWhitelist = user.panelIpWhitelist || [];
      userName = user.name;
    }
  }

  // If IP whitelisting is not enabled, proceed
  if (!isPanelIpWhitelistEnabled) {
    return next();
  }

  // If IP whitelisting is enabled, check if client IP is in the whitelist
  if (!panelIpWhitelist || panelIpWhitelist.length === 0) {
    throw Forbidden(
      "Panel IP whitelist is enabled but no IPs are configured. Please contact administrator."
    );
  }

  // Check if client IP is in the whitelist
  const isIpAllowed = panelIpWhitelist.some((allowedIp) => {
    // Exact match
    if (allowedIp === clientIp) return true;

    // Support CIDR notation if needed (basic implementation)
    // For now, just exact match
    return false;
  });

  if (!isIpAllowed) {
    // Determine actor type for audit logging
    const actorType = Object.values(ADMIN_ROLES).includes(role as any)
      ? "ADMIN"
      : "MERCHANT";

    const userType = Object.values(ADMIN_ROLES).includes(role as any)
      ? ActorType.ADMIN
      : ActorType.MERCHANT;

    // Audit logging using audit context
    await AuditService.record({
      action: `${actorType}_REQUEST_BLOCKED_IP`,
      actorType: actorType as any,
      actorId: email || userId,
      actorName: userName,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      requestId: auditContext.requestId,
      metadata: {
        reason: "ip_not_whitelisted",
        requestPath: c.req.path,
        requestMethod: c.req.method,
      },
    });

    // Login history tracking
    await LoginHistoryService.logAttempt({
      userId: userId,
      userType: userType,
      email: email || "unknown",
      ipAddress: auditContext.ipAddress || "unknown",
      userAgent: auditContext.userAgent || "unknown",
      status: LoginStatus.FAILED,
      failureReason: "IP not whitelisted",
    });

    throw Forbidden(
      `Access denied. Your IP address (${clientIp}) is not whitelisted for panel access.`
    );
  }

  // IP is whitelisted, proceed
  return next();
};
