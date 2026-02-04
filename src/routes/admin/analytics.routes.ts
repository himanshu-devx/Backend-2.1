import { Hono } from "hono";
import { authMiddleware, authorizeRoles } from "@/middlewares/auth.middleware";
import { AdminAnalyticsController } from "@/controllers/admin/analytics.controller";
import { ADMIN_ROLES } from "@/constants/users.constant";

const adminAnalyticsRoutes = new Hono();

adminAnalyticsRoutes.use(authMiddleware);
adminAnalyticsRoutes.use(
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN])
);

adminAnalyticsRoutes.get("/stats", AdminAnalyticsController.getAnalytics);

export { adminAnalyticsRoutes };
