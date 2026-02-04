import { Hono } from "hono";
import { authMiddleware, authorizeRoles } from "@/middlewares/auth.middleware";
import { validateBody, validateQuery } from "@/middlewares/validate";
import { AdminMerchantBankAccountController } from "@/controllers/admin/merchant-bank-account.controller";
import {
  ListMerchantBankAccountSchema,
  UpdateMerchantBankAccountStatusSchema,
  ToggleMerchantBankAccountActiveSchema,
} from "@/dto/merchant-bank-account.dto";
import { ADMIN_ROLES } from "@/constants/users.constant";

const adminMerchantBankAccountRoutes = new Hono();

adminMerchantBankAccountRoutes.use(
  "*",
  authMiddleware,
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.SUPPORT, // Support might need read access
    ADMIN_ROLES.ACCOUNTANT, // Accountants might need to verify
  ])
);

// List all (supports filtering by merchantId, status via query)
adminMerchantBankAccountRoutes.get(
  "/",
  validateQuery(ListMerchantBankAccountSchema),
  AdminMerchantBankAccountController.list
);

// Approve/Reject
adminMerchantBankAccountRoutes.put(
  "/:id/status",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(UpdateMerchantBankAccountStatusSchema),
  AdminMerchantBankAccountController.updateStatus
);

// Toggle Active
adminMerchantBankAccountRoutes.put(
  "/:id/active",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(ToggleMerchantBankAccountActiveSchema),
  AdminMerchantBankAccountController.toggleActive
);

export default adminMerchantBankAccountRoutes;
