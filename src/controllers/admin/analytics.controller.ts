import { Context } from "hono";
import { AnalyticsService } from "@/services/analytics/analytics.service";
import { respond } from "@/utils/result-http";
import { ok, err } from "@/utils/result";
import { AppError } from "@/utils/error";

export class AdminAnalyticsController {
  static async getAnalytics(c: Context) {
    const { startDate, endDate, bucket, merchantId, providerId, legalEntityId } = c.req.query();

    const filters: any = {};

    // Validate and parse dates with strict YYYY-MM-DD format
    try {
      if (startDate && endDate) {
        const { parseDateRangeToIST } = await import("@/utils/date.util");
        const dateRange = parseDateRangeToIST(startDate, endDate);
        filters.startDate = dateRange.startDate;
        filters.endDate = dateRange.endDate;
      } else if (startDate || endDate) {
        // If only one date is provided, return error
        return respond(c, err(new AppError("Both startDate and endDate are required", { status: 400 })));
      }
    } catch (error: any) {
      return respond(c, err(new AppError(error.message || "Invalid date format. Expected YYYY-MM-DD", { status: 400 })));
    }

    // Additional admin filters
    if (merchantId) filters.merchantId = merchantId;
    if (providerId) filters.providerId = providerId;
    if (legalEntityId) filters.legalEntityId = legalEntityId;

    // Map bucket to timeFrame
    let timeFrame: "hourly" | "daily" = "daily";

    // Logic: 
    // 1. If single date (startDate == endDate) -> Hourly
    // 2. If range -> Daily (No limit)
    if (startDate && endDate) {
      // Simple string comparison works for YYYY-MM-DD format
      if (startDate === endDate) {
        timeFrame = "hourly";
      } else {
        timeFrame = "daily";
      }
    } else {
      // Default behavior if no dates provided: Today, Hourly
      const { getTodayRangeIST } = await import("@/utils/date.util");
      const todayRange = getTodayRangeIST();

      filters.startDate = todayRange.start;
      filters.endDate = todayRange.end;

      timeFrame = "hourly";
    }

    const analytics = await AnalyticsService.getDetailedDashboardStats({
      ...filters,
      timeFrame
    });

    return respond(c, ok(analytics));
  }
}
