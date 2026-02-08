import { Hono } from "hono";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { authorizeRoles } from "@/middlewares/auth.middleware";
import { handler } from "@/utils/handler";
import { ADMIN_ROLES } from "@/constants/users.constant";
import { validateBody, validateQuery } from "@/middlewares/validate";
import { ListQuerySchema } from "@/dto/common.dto";
import { MerchantManagementController } from "@/controllers";
import { AdminController } from "@/controllers/admin/auth.controller";
import {
  UpdatePanelIpWhitelistSchema,
  UpdateMerchantProfileSchema,
  UpdateServiceConfigSchema,
  ToggleApiSecretSchema,
  AddFeeTierSchema,
  DeleteFeeTierSchema,
} from "@/dto/merchant/merchant.dto";

const adminMerchantsRoutes = new Hono();
adminMerchantsRoutes.use("*", authMiddleware);

adminMerchantsRoutes.get(
  "/list-merchants",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.SUPPORT,
    ADMIN_ROLES.TECHNICAL,
    ADMIN_ROLES.ACCOUNTANT,
  ]),
  validateQuery(ListQuerySchema),
  handler(MerchantManagementController.getMerchantList)
);

adminMerchantsRoutes.get(
  "/:id",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.SUPPORT,
    ADMIN_ROLES.TECHNICAL,
    ADMIN_ROLES.ACCOUNTANT,
  ]),
  handler(MerchantManagementController.getMerchantProfile)
);

adminMerchantsRoutes.get(
  "/:id/activity",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.SUPPORT,
    ADMIN_ROLES.TECHNICAL,
    ADMIN_ROLES.ACCOUNTANT,
  ]),
  handler(MerchantManagementController.getMerchantActivity)
);

adminMerchantsRoutes.get(
  "/:id/bank-accounts",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.SUPPORT,
    ADMIN_ROLES.TECHNICAL,
    ADMIN_ROLES.ACCOUNTANT,
  ]),
  handler(MerchantManagementController.getBankAccounts)
);

adminMerchantsRoutes.post(
  "/:id/onboard",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  handler(AdminController.onboardMerchant)
);

adminMerchantsRoutes.put(
  "/:id/status",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  handler(MerchantManagementController.toggleMerchantStatus)
);

adminMerchantsRoutes.put(
  "/:id/panel-ip-whitelist",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
    ADMIN_ROLES.SUPPORT,
  ]),
  validateBody(UpdatePanelIpWhitelistSchema),

  handler(MerchantManagementController.updateIpWhitelist)
);

adminMerchantsRoutes.put(
  "/:id/profile",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
    ADMIN_ROLES.SUPPORT,
  ]),
  validateBody(UpdateMerchantProfileSchema),
  handler(MerchantManagementController.updateProfile)
);

adminMerchantsRoutes.put(
  "/:id/payin-config",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  validateBody(UpdateServiceConfigSchema),
  handler(MerchantManagementController.updatePayinConfig)
);

adminMerchantsRoutes.put(
  "/:id/payout-config",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  validateBody(UpdateServiceConfigSchema),
  handler(MerchantManagementController.updatePayoutConfig)
);

adminMerchantsRoutes.put(
  "/:id/routing",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  handler(MerchantManagementController.updateRouting)
);

// --- Fee Management Routes ---

adminMerchantsRoutes.post(
  "/:id/payin-config/fees",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  validateBody(AddFeeTierSchema),
  handler(MerchantManagementController.addPayinFee)
);

adminMerchantsRoutes.delete(
  "/:id/payin-config/fees",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  validateBody(DeleteFeeTierSchema),
  handler(MerchantManagementController.deletePayinFee)
);

adminMerchantsRoutes.post(
  "/:id/payout-config/fees",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  validateBody(AddFeeTierSchema),
  handler(MerchantManagementController.addPayoutFee)
);

adminMerchantsRoutes.delete(
  "/:id/payout-config/fees",
  authorizeRoles([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.TECHNICAL,
  ]),
  validateBody(DeleteFeeTierSchema),
  handler(MerchantManagementController.deletePayoutFee)
);

adminMerchantsRoutes.get(
  "/:id/api-secret",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  handler(MerchantManagementController.getApiSecret)
);

adminMerchantsRoutes.post(
  "/:id/rotate-api-secret",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  handler(MerchantManagementController.rotateApiSecret)
);

adminMerchantsRoutes.put(
  "/:id/toggle-api-secret",
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
  validateBody(ToggleApiSecretSchema),
  handler(MerchantManagementController.toggleApiSecret)
);

export default adminMerchantsRoutes;
