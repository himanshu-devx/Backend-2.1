import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import {
  CreateLoginHistoryDTO,
  ListLoginHistoryQueryDTO,
} from "@/dto/login-history.dto";
import { loginHistoryRepository } from "@/repositories/login-history.repository";
import { ok, err, Result } from "@/utils/result"; // Assuming result util exists
import { HttpError, AppError } from "@/utils/error"; // Assuming error util exists

export class LoginHistoryService {
  static async logAttempt(data: CreateLoginHistoryDTO): Promise<void> {
    try {
      // 1. Parse User Agent
      const parser = new UAParser(data.userAgent);
      const ua = parser.getResult();
      const browser = `${ua.browser.name || ""} ${ua.browser.version || ""
        }`.trim();
      const os = `${ua.os.name || ""} ${ua.os.version || ""}`.trim();
      const device = ua.device.type || "desktop";

      // 2. Lookup GeoIP
      // Note: geoip-lite works best with public IPs. Localhost (127.0.0.1) returns null.
      const geo = geoip.lookup(data.ipAddress);
      const location = geo
        ? {
          country: geo.country,
          region: geo.region,
          city: geo.city,
          ll: geo.ll,
        }
        : undefined;

      // 3. Save to DB
      await loginHistoryRepository.create({
        ...data,
        browser: browser || "Unknown",
        os: os || "Unknown",
        device: device,
        location,
      });
    } catch (error) {
      console.error("Failed to log login attempt:", error);
      // We do NOT throw here to avoid blocking the auth flow
    }
  }

  static async listHistory(
    queryDto: ListLoginHistoryQueryDTO
  ): Promise<Result<any, HttpError>> {
    const filter: any = {};

    if (queryDto.userId) filter.userId = queryDto.userId;
    if (queryDto.userType) filter.userType = queryDto.userType;

    if (queryDto.search) {
      filter.email = { $regex: queryDto.search, $options: "i" };
    } else if (queryDto.email) {
      filter.email = queryDto.email;
    }

    if (queryDto.status) filter.status = queryDto.status;

    if (queryDto.startDate || queryDto.endDate) {
      if (!queryDto.startDate || !queryDto.endDate) {
        return err(new AppError("Both startDate and endDate are required", { status: 400 }));
      }

      try {
        const { parseDateRangeToIST } = await import("@/utils/date.util");
        const dateRange = parseDateRangeToIST(queryDto.startDate, queryDto.endDate);
        filter.createdAt = {
          $gte: dateRange.startDate,
          $lte: dateRange.endDate
        };
      } catch (error: any) {
        return err(new AppError(error.message || "Invalid date format. Expected YYYY-MM-DD", { status: 400 }));
      }
    }

    const result = await loginHistoryRepository.list({
      filter,
      page: queryDto.page,
      limit: queryDto.limit,
      sort: { createdAt: -1 },
    });

    return ok(result);
  }
}
