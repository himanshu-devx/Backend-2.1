import { Context } from "hono";
import { LoginHistoryService } from "@/services/common/login-history.service";
import { ListLoginHistoryQueryDTO } from "@/dto/login-history.dto";
import { ActorType, LoginStatus } from "@/models/login-history.model";
import { isErr } from "@/utils/result";

export class LoginHistoryController {
  // Get history for the currently logged-in user
  static async getOwnHistory(c: Context) {
    const id = c.get("id");
    const role = c.get("role"); // Assuming role is set in context

    // Determine UserType from token role/context
    // This depends on how your auth middleware sets context.
    // For now, mapping role to ActorType:
    let userType = ActorType.UNKNOWN;
    if (role) {
      // Admin roles
      if (["SUPER_ADMIN", "ADMIN", "SUPPORT", "TECHNICAL"].includes(role))
        userType = ActorType.ADMIN;
      else userType = ActorType.MERCHANT; // Simplification
    }

    const query: ListLoginHistoryQueryDTO = {
      userId: id,
      userType: userType, // Optional: Strict filter by own type
      page: Number(c.req.query("page") || 1),
      limit: Number(c.req.query("limit") || 10),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      status: c.req.query("status") as LoginStatus,
    };

    const result = await LoginHistoryService.listHistory(query);
    if (isErr(result)) {
      const e = result.error;
      const msg = typeof e === "string" ? e : e.message;
      const status = typeof e === "string" ? 500 : e.status;
      return c.json({ message: msg }, status);
    }
    return c.json(result.value);
  }

  // Admin: View all history (with filters)
  static async getAllHistory(c: Context) {
    const query: ListLoginHistoryQueryDTO = {
      userId: c.req.query("userId"),
      userType: c.req.query("userType") as ActorType,
      email: c.req.query("email"),
      page: Number(c.req.query("page") || 1),
      limit: Number(c.req.query("limit") || 10),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      status: c.req.query("status") as LoginStatus,
      search: c.req.query("search"),
    };

    const result = await LoginHistoryService.listHistory(query);
    if (isErr(result)) {
      const e = result.error;
      const msg = typeof e === "string" ? e : e.message;
      const status = typeof e === "string" ? 500 : e.status;
      return c.json({ message: msg }, status);
    }

    return c.json(result.value);
  }
}
