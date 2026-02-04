// src/utils/ip-validation.util.ts

import { AuditService } from "@/services/common/audit.service";
import { LoginHistoryService } from "@/services/common/login-history.service";
import { ActorType, LoginStatus } from "@/models/login-history.model";
import { ADMIN_ROLES } from "@/constants/users.constant";
import { ENV } from "@/config/env";
import { AuditContext } from "@/utils/audit.util";
import { Forbidden } from "@/utils/error";

interface IpValidationOptions {
  action: string; // e.g., "LOGIN", "VERIFY_OTP", "PASSWORD_RESET"
  auditContext?: AuditContext;
}

/**
 * Validates IP address for an admin user
 * For SUPER_ADMIN: Checks ENV variables
 * For other admins: Checks database settings
 *
 * @throws Forbidden error if IP is not whitelisted
 */
export async function validateAdminIp(
  admin: {
    id?: string;
    email: string;
    name: string;
    role: string;
    isPanelIpWhitelistEnabled: boolean;
    panelIpWhitelist: string[];
  },
  options: IpValidationOptions
): Promise<void> {
  const { action, auditContext } = options;
  const currentIp = auditContext?.ipAddress;

  // Check if user is SUPER_ADMIN - use ENV variables
  if (admin.role === ADMIN_ROLES.SUPER_ADMIN) {
    // SUPER_ADMIN uses ENV configuration
    if (ENV.SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED) {
      const envIps = ENV.SUPER_ADMIN_IPS
        ? ENV.SUPER_ADMIN_IPS.split(",").map((i) => i.trim())
        : [];

      const isAllowed = envIps.includes(currentIp || "");

      if (!isAllowed) {
        await logIpBlockedAudit({
          action: `ADMIN_${action}_BLOCKED_IP`,
          actorType: "ADMIN",
          actorId: admin.email,
          actorName: admin.name,
          auditContext,
          metadata: { reason: "ip_not_whitelisted", source: "env" },
        });

        await logIpBlockedHistory({
          userId: admin.id || admin.email,
          userType: ActorType.ADMIN,
          email: admin.email,
          auditContext,
          failureReason: `IP not whitelisted (ENV) - ${action}`,
        });

        throw Forbidden(
          `Access denied: Your IP address (${currentIp}) is not whitelisted for panel access.`
        );
      }
    }
  } else {
    // Other admins use database configuration
    if (admin.isPanelIpWhitelistEnabled) {
      const isAllowed = admin.panelIpWhitelist.includes(currentIp || "");

      if (!isAllowed) {
        await logIpBlockedAudit({
          action: `ADMIN_${action}_BLOCKED_IP`,
          actorType: "ADMIN",
          actorId: admin.email,
          actorName: admin.name,
          auditContext,
          metadata: { reason: "ip_not_whitelisted", source: "database" },
        });

        await logIpBlockedHistory({
          userId: admin.id || admin.email,
          userType: ActorType.ADMIN,
          email: admin.email,
          auditContext,
          failureReason: `IP not whitelisted - ${action}`,
        });

        throw Forbidden(
          `Access denied: Your IP address (${currentIp}) is not whitelisted for panel access.`
        );
      }
    }
  }
}

/**
 * Validates IP address for a merchant user
 * Always checks database settings (no ENV for merchants)
 *
 * @throws Forbidden error if IP is not whitelisted
 */
export async function validateMerchantIp(
  merchant: {
    id?: string;
    email: string;
    name?: string;
    isPanelIpWhitelistEnabled: boolean;
    panelIpWhitelist: string[];
  },
  options: IpValidationOptions
): Promise<void> {
  const { action, auditContext } = options;
  const currentIp = auditContext?.ipAddress;

  // Merchants always use database configuration
  if (merchant.isPanelIpWhitelistEnabled) {
    const isAllowed = merchant.panelIpWhitelist.includes(currentIp || "");

    if (!isAllowed) {
      await logIpBlockedAudit({
        action: `MERCHANT_${action}_BLOCKED_IP`,
        actorType: "MERCHANT",
        actorId: merchant.email,
        actorName: merchant.name || merchant.email,
        auditContext,
        metadata: { reason: "ip_not_whitelisted", source: "database" },
      });

      await logIpBlockedHistory({
        userId: merchant.id || merchant.email,
        userType: ActorType.MERCHANT,
        email: merchant.email,
        auditContext,
        failureReason: `IP not whitelisted - ${action}`,
      });

      throw Forbidden(
        `Access denied: Your IP address (${currentIp}) is not whitelisted for panel access.`
      );
    }
  }
}

/**
 * Helper: Logs audit event when IP is blocked
 */
async function logIpBlockedAudit(params: {
  action: string;
  actorType: "ADMIN" | "MERCHANT";
  actorId: string;
  actorName: string;
  auditContext?: AuditContext;
  metadata?: Record<string, any>;
}): Promise<void> {
  const { action, actorType, actorId, actorName, auditContext, metadata } =
    params;

  if (auditContext) {
    await AuditService.record({
      action,
      actorType,
      actorId,
      actorName,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      requestId: auditContext.requestId,
      metadata,
    });
  }
}

/**
 * Helper: Logs login history when IP is blocked
 */
async function logIpBlockedHistory(params: {
  userId: string;
  userType: ActorType;
  email: string;
  auditContext?: AuditContext;
  failureReason: string;
}): Promise<void> {
  const { userId, userType, email, auditContext, failureReason } = params;

  if (auditContext) {
    await LoginHistoryService.logAttempt({
      userId,
      userType,
      email,
      ipAddress: auditContext.ipAddress || "unknown",
      userAgent: auditContext.userAgent || "unknown",
      status: LoginStatus.FAILED,
      failureReason,
    });
  }
}
