// src/routes/admin.routes.ts

import { Hono } from "hono";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { authorizeRoles } from "@/middlewares/auth.middleware";
import { handler } from "@/utils/handler";
import {
  AdminController,
  LoginHistoryController,
  TransactionController,
} from "@/controllers";
import { ADMIN_ROLES } from "@/constants/users.constant";
import { validateBody, validateQuery } from "@/middlewares/validate";
import {
  CreateAdminSchema,
  UpdateAdminRoleSchema,
  UpdatePanelIpWhitelistSchema,
  ListLoginHistorySchema,
  UpdateAdminProfileSchema,
} from "@/dto/admin/admin.dto";
import { ListQuerySchema, TransactionListQuerySchema } from "@/dto/common.dto";
import { ReverseTransactionSchema } from "@/dto/admin/transaction.dto";

const adminManageRoutes = new Hono();

adminManageRoutes.post(
  "/create-admin",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(CreateAdminSchema),
  handler(AdminController.createAdmin)
);

adminManageRoutes.put(
  "/profile",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(UpdateAdminProfileSchema),
  handler(AdminController.updateOwnProfile)
);

adminManageRoutes.put(
  "/:id/profile",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(UpdateAdminProfileSchema),
  handler(AdminController.updateAdminProfile)
);

adminManageRoutes.get(
  "/list-admins",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateQuery(ListQuerySchema),
  handler(AdminController.getAdminList)
);

// Login history routes MUST come before /:id to avoid path collision
adminManageRoutes.get(
  "/login-history",
  handler(LoginHistoryController.getOwnHistory)
);

adminManageRoutes.get(
  "/login-history-all",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateQuery(ListLoginHistorySchema),
  handler(LoginHistoryController.getAllHistory)
);

// --- Dashboard & Analytics ---
adminManageRoutes.get(
  "/dashboard/stats",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  handler(AdminController.getDashboardStats)
);


// --- Transaction View (Admin Side) ---

adminManageRoutes.get(
  "/transactions",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.SUPPORT,
  ]),
  validateQuery(TransactionListQuerySchema), // Use generic list schema for now, or create specific
  handler(TransactionController.listAdmin)
);

adminManageRoutes.get(
  "/transactions/:id",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.SUPPORT,
  ]),
  handler(TransactionController.getDetails)
);

adminManageRoutes.post(
  "/transactions/:id/reverse",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
  ]),
  validateBody(ReverseTransactionSchema),
  handler(TransactionController.reverseAdmin)
);

// Dynamic :id routes come after specific routes
adminManageRoutes.get(
  "/:id",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  handler(AdminController.getAdminProfile)
);

adminManageRoutes.put(
  "/:id/status",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  handler(AdminController.toggleAdminStatus)
);

adminManageRoutes.patch(
  "/:id/role",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(UpdateAdminRoleSchema),
  handler(AdminController.updateAdminRole)
);

adminManageRoutes.put(
  "/:id/panel-ip-whitelist",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(UpdatePanelIpWhitelistSchema),
  handler(AdminController.updateIpWhitelist)
);

export default adminManageRoutes;
