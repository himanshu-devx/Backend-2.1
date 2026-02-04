import { Context } from "hono";
import { MerchantSelfService } from "@/services/merchant/merchant-self.service";
import { respond } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import { Unauthorized, AppError } from "@/utils/error"; // Import Unauthorized
import { err, ok } from "@/utils/result"; // Added ok
import { NotFound } from "@/utils/error";
import { LedgerAccountModel } from "@/models/ledger-account.model";
import { ACCOUNT_TYPE } from "@/constants/tigerbeetle.constant";

export class MerchantSelfController {
  static async getOwnBasicProfile(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));
    const result = await MerchantSelfService.getOwnBasicProfile(merchantId);
    return respond(c, result);
  }

  static async getOwnPayinConfig(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));
    const result = await MerchantSelfService.getOwnPayinConfig(merchantId);
    return respond(c, result);
  }

  static async getOwnPayoutConfig(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));
    const result = await MerchantSelfService.getOwnPayoutConfig(merchantId);
    return respond(c, result);
  }

  static async getOwnApiKeys(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));
    const result = await MerchantSelfService.getOwnApiKeys(merchantId);
    return respond(c, result);
  }

  // --- Actions ---

  static async updateCallbackUrl(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));

    const { type, url } = await c.req.json<{
      type: "PAYIN" | "PAYOUT";
      url: string;
    }>();
    const auditContext = getAuditContext(c);

    // Basic validation if DTO not used via middleware yet for this custom inline body
    if (!type || !url)
      return respond(c, err(Unauthorized("Invalid request body")));

    const result = await MerchantSelfService.updateCallbackUrl(
      merchantId,
      type,
      url,
      auditContext
    );
    return respond(c, result);
  }

  static async rotateApiSecret(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));

    const auditContext = getAuditContext(c);
    const result = await MerchantSelfService.rotateApiSecret(
      merchantId,
      auditContext
    );
    return respond(c, result);
  }

  static async updateProfile(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));

    const body = await c.req.json<{ displayName?: string }>();
    const auditContext = getAuditContext(c);
    const result = await MerchantSelfService.updateSelfProfile(
      merchantId,
      body,
      auditContext
    );
    return respond(c, result);
  }

  static async getDashboardStats(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));

    const { startDate, endDate, bucket } = c.req.query();

    const filters: any = {};
    let timeFrame: "hourly" | "daily" = "daily";

    // Validate and parse dates with strict YYYY-MM-DD format
    try {
      if (startDate && endDate) {
        const { parseDateRangeToIST } = await import("@/utils/date.util");
        const dateRange = parseDateRangeToIST(startDate, endDate);
        filters.startDate = dateRange.startDate;
        filters.endDate = dateRange.endDate;

        // Logic: 
        // 1. If single date (startDate == endDate) -> Hourly
        // 2. If range -> Daily (Max 7 days)
        if (startDate === endDate) {
          timeFrame = "hourly";
        } else {
          timeFrame = "daily";

          // Check 7 day limit for merchant dashboard
          const start = new Date(startDate);
          const end = new Date(endDate);
          const diffTime = Math.abs(end.getTime() - start.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays > 7) {
            return respond(c, err(new AppError("Date range cannot exceed 7 days for daily view.", { status: 400 })));
          }
        }
      } else if (startDate || endDate) {
        // If only one date is provided, return error
        return respond(c, err(new AppError("Both startDate and endDate are required", { status: 400 })));
      } else {
        // Default behavior if no dates provided: Today, Hourly
        const { getTodayRangeIST } = await import("@/utils/date.util");
        const todayRange = getTodayRangeIST();

        filters.startDate = todayRange.start;
        filters.endDate = todayRange.end;
        timeFrame = "hourly";
      }
    } catch (error: any) {
      return respond(c, err(new AppError(error.message || "Invalid date format. Expected YYYY-MM-DD", { status: 400 })));
    }

    const { AnalyticsService } = await import(
      "@/services/analytics/analytics.service"
    );

    // Use the detailed stats method
    const analytics = await AnalyticsService.getDetailedDashboardStats({
      ...filters,
      merchantId: merchantId,
      merchantIds: [merchantId], // Pass explicit merchantId array for safety
      timeFrame
    });

    if (!analytics) return respond(c, err(NotFound("No analytics data found")));

    return c.json({ success: true, data: analytics });
  }

  static async getOwnLedgerAccounts(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));

    const { AccountManagerService } = await import(
      "@/services/ledger/account-manager.service"
    );
    const accounts = await AccountManagerService.getMerchantAccounts(
      merchantId
    );

    return c.json({ success: true, data: accounts });
  }

  static async getOwnLedgerAccountById(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));

    let accountId = c.req.param("accountId");
    if (!accountId) {
      return c.json({ success: false, error: "Account ID required" }, 400);
    }

    const resolvedId = await MerchantSelfController.resolveMerchantAccountId(merchantId, accountId);
    if (!resolvedId) {
      return c.json({ success: false, error: "Account not found" }, 404);
    }
    accountId = resolvedId;

    const { AccountManagerService } = await import(
      "@/services/ledger/account-manager.service"
    );
    const account = await AccountManagerService.getAccountById(accountId);

    // Verify ownership
    if (!account || account.ownerId !== merchantId) {
      return c.json({ success: false, error: "Account not found" }, 404);
    }

    return c.json({ success: true, data: account });
  }

  static async getOwnAccountTransfers(c: Context) {
    const merchantId = c.get("id");
    if (!merchantId) return respond(c, err(Unauthorized("Not authenticated")));

    let accountId = c.req.param("accountId");
    const resolvedId = await MerchantSelfController.resolveMerchantAccountId(merchantId, accountId);
    if (!resolvedId) {
      return c.json(err(NotFound("Account not found")), 404);
    }
    accountId = resolvedId;

    const { AccountManagerService } = await import(
      "@/services/ledger/account-manager.service"
    );

    // Verify ownership
    const account = await AccountManagerService.getAccountById(accountId);
    if (!account || account.ownerId !== merchantId) {
      return c.json(err(NotFound("Account not found")), 404);
    }

    try {
      const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 100;
      const reversed = c.req.query("reversed") !== "false";
      const parseTbTimestamp = (val: string | undefined): bigint | undefined => {
        if (!val) return undefined;
        // If numeric string, assume valid TB timestamp
        if (/^\d+$/.test(val)) return BigInt(val);
        // If ISO date string
        const date = new Date(val);
        if (!isNaN(date.getTime())) {
          // TB usually uses nanoseconds (ms * 1000000)
          return BigInt(date.getTime()) * 1000000n;
        }
        return undefined;
      };

      const timestampMin = parseTbTimestamp(c.req.query("timestampMin"));
      const timestampMax = parseTbTimestamp(c.req.query("timestampMax"));

      const transfers = await AccountManagerService.getTransfersByAccountId(
        accountId,
        { limit, reversed, timestampMin, timestampMax }
      );
      return c.json({ success: true, data: transfers }); // Consistent response format
    } catch (e: any) {
      return c.json(err(e), 500);
    }
  }

  // Helper to resolve shorthands like "PAYIN", "PAYOUT" to actual Account IDs
  private static async resolveMerchantAccountId(merchantId: string, id: string): Promise<string | null> {
    const typeMap: Record<string, string> = {
      "PAYIN": ACCOUNT_TYPE.MERCHANT_PAYIN.slug,
      "PAYOUT": ACCOUNT_TYPE.MERCHANT_PAYOUT.slug,
      "HOLD": ACCOUNT_TYPE.MERCHANT_HOLD.slug
    };

    if (typeMap[id]) {
      const account = await LedgerAccountModel.findOne({
        ownerId: merchantId,
        typeSlug: typeMap[id]
      }).lean();
      return account ? account.accountId : null;
    }

    return id;
  }
}
