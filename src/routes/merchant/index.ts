import { Hono } from "hono";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { authorizeRoles } from "@/middlewares/auth.middleware";
import { handler } from "@/utils/handler";
import {
  MerchantSelfController,
  LoginHistoryController,
} from "@/controllers";
import { MERCHANT_ROLES } from "@/constants/users.constant";
import { panelIpWhitelistMiddleware } from "@/middlewares/panel-ip-whitelist.middleware";
import merchantBankAccountRoutes from "./bank-account.routes";
import merchantTransactionRoutes from "./transaction.routes";
import merchantLedgerRoutes from "./ledger.routes";
import merchantReportRoutes from "./report.routes";

const merchantRoutes = new Hono();

// Apply auth middleware to all merchant routes
merchantRoutes.use(authMiddleware);
merchantRoutes.use(panelIpWhitelistMiddleware);

merchantRoutes.route("/bank-accounts", merchantBankAccountRoutes);
merchantRoutes.route("/transactions", merchantTransactionRoutes);
merchantRoutes.route("/ledger", merchantLedgerRoutes);
merchantRoutes.route("/reports", merchantReportRoutes);

merchantRoutes.get(
  "/login-history",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(LoginHistoryController.getOwnHistory)
);

// Dashboard Data (Read-Only)
merchantRoutes.get(
  "/profile/basic",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnBasicProfile)
);

merchantRoutes.get(
  "/profile/payin",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnPayinConfig)
);

merchantRoutes.get(
  "/profile/payout",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnPayoutConfig)
);


merchantRoutes.get(
  "/api-keys/secret",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnApiSecret)
);

merchantRoutes.get(
  "/dashboard/stats",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getDashboardStats)
);


merchantRoutes.put(
  "/config/callback-url",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.updateCallbackUrl)
);

merchantRoutes.post(
  "/api-keys/rotate",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.rotateApiSecret)
);

merchantRoutes.put(
  "/profile",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.updateProfile)
);


export default merchantRoutes;
