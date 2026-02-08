import { ok, err, Result } from "@/utils/result";
import { HttpError, AppError } from "@/utils/error";
import { merchantRepository } from "@/repositories/merchant.repository";
import { adminRepository } from "@/repositories/admin.repository";
import { MerchantModel } from "@/models/merchant.model";
import { AdminModel } from "@/models/admin.model";

import { AnalyticsService } from "@/services/analytics/analytics.service";

export class DashboardService {
  static async getStats(
    startDate?: string,
    endDate?: string,
    merchantId?: string | string[],
    providerId?: string | string[],
    legalEntityId?: string | string[],
    bucket?: "hourly" | "daily"
  ): Promise<Result<any, HttpError>> {
    const filters: any = {};
    const normalizeBucket = (value?: string): "hourly" | "daily" | undefined => {
      if (!value) return undefined;
      if (value === "hourly" || value === "hour") return "hourly";
      if (value === "daily" || value === "day") return "daily";
      return undefined;
    };
    const normalizedBucket = normalizeBucket(bucket);
    let timeFrame: "hourly" | "daily" = "daily";

    // Validate and parse dates with strict YYYY-MM-DD format
    if (startDate || endDate) {
      if (!startDate || !endDate) {
        return err(new AppError("Both startDate and endDate are required", { status: 400 }));
      }

      try {
        const { parseDateRangeToIST } = await import("@/utils/date.util");
        const dateRange = parseDateRangeToIST(startDate, endDate);
        filters.startDate = dateRange.startDate;
        filters.endDate = dateRange.endDate;
        timeFrame = normalizedBucket || (startDate === endDate ? "hourly" : "daily");
      } catch (error: any) {
        return err(new AppError(error.message || "Invalid date format. Expected YYYY-MM-DD", { status: 400 }));
      }
    } else {
      // Default behavior: Today (Consistent with controllers)
      const { getTodayRangeIST } = await import("@/utils/date.util");
      const todayRange = getTodayRangeIST();
      filters.startDate = todayRange.start;
      filters.endDate = todayRange.end;
      timeFrame = normalizedBucket || "hourly";
    }

    if (merchantId) {
      if (Array.isArray(merchantId)) filters.merchantIds = merchantId;
      else filters.merchantId = merchantId;
    }
    if (providerId) {
      if (Array.isArray(providerId)) filters.providerIds = providerId;
      else filters.providerId = providerId;
    }
    if (legalEntityId) {
      if (Array.isArray(legalEntityId)) filters.legalEntityIds = legalEntityId;
      else filters.legalEntityId = legalEntityId;
    }
    if (normalizedBucket) filters.bucket = normalizedBucket;
    filters.timeFrame = timeFrame;

    // 1. Merchant Stats
    const totalMerchants = await MerchantModel.countDocuments({});
    const activeMerchants = await MerchantModel.countDocuments({
      status: true,
    });
    const inactiveMerchants = await MerchantModel.countDocuments({
      status: false,
    });

    // 2. Admin Stats
    const totalAdmins = await AdminModel.countDocuments({});
    const superAdmins = await AdminModel.countDocuments({
      role: "SUPER_ADMIN",
    });

    // 3. System Health (Stubbed for now)
    const systemStatus = "HEALTHY";

    // 4. Detailed Analytics (Payin, Payout, Transactions)
    const analytics = await AnalyticsService.getDetailedDashboardStats(filters);

    return ok({
      merchants: {
        total: totalMerchants,
        active: activeMerchants,
        inactive: inactiveMerchants,
      },
      admins: {
        total: totalAdmins,
        superAdmins: superAdmins,
      },
      system: {
        status: systemStatus,
      },
      payin: {
        ...analytics.payin,
        successAmount: analytics.payin.successVolume,
        success: analytics.payin.successCount,
        pending: analytics.payin.pendingCount,
        failed: analytics.payin.failedCount,
        total: analytics.payin.totalCount,
      },
      payout: {
        ...analytics.payout,
        successAmount: analytics.payout.successVolume,
        success: analytics.payout.successCount,
        pending: analytics.payout.pendingCount,
        failed: analytics.payout.failedCount,
        total: analytics.payout.totalCount,
      },
      transactions: {
        count: (analytics.payin?.totalCount || 0) + (analytics.payout?.totalCount || 0),
        totalVolume: (analytics.payin?.totalVolume || 0) + (analytics.payout?.totalVolume || 0)
      },
      timeSeries: analytics.timeSeries, // Chart data
      // Map timeSeries to revenueChart for compatibility
      revenueChart: analytics.timeSeries.map((item: any) => ({
        date: item.date,
        revenue: item.payin,
        expenses: item.payout,
        fullDate: item.fullDate
      }))

    });
  }
}
