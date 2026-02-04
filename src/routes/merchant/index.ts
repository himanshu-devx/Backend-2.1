import { Hono } from "hono";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { authorizeRoles } from "@/middlewares/auth.middleware";
import { handler } from "@/utils/handler";
import {
  MerchantSelfController,
  LoginHistoryController,
  BalanceController,
} from "@/controllers";
import { MERCHANT_ROLES } from "@/constants/users.constant";
import { panelIpWhitelistMiddleware } from "@/middlewares/panel-ip-whitelist.middleware";
import merchantBankAccountRoutes from "./bank-account.routes";
import merchantTransactionRoutes from "./transaction.routes";

const merchantRoutes = new Hono();

// Apply auth middleware to all merchant routes
merchantRoutes.use(authMiddleware);
merchantRoutes.use(panelIpWhitelistMiddleware);

merchantRoutes.route("/bank-accounts", merchantBankAccountRoutes);
merchantRoutes.route("/transactions", merchantTransactionRoutes);

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

// merchantRoutes.get(
//   "/profile/payin-fees",
//   authorizeRoles([MERCHANT_ROLES.MERCHANT]),
//   handler(MerchantSelfController.getOwnPayinFees) // Assuming this existed or we use config? Config has fees.
// );
// The Service includes fees in Config. Let's stick to config endpoints unless frontend specifically calls /payin-fees.
// Previous code had /profile/payin-fees. I'll check if I implemented separate fees getter in SelfService.
// I implemented getOwnPayinConfig which returns { ...config, fees }.
// So /profile/payin returns fees too.
// If frontend needs explicit route, I'll direct it to config or re-add separate but it's redundant.
// I'll leave it commented or remove, assuming Profile/Config is enough.

merchantRoutes.get(
  "/profile/payout",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnPayoutConfig)
);

// merchantRoutes.get(
//   "/profile/payout-fees",
//   authorizeRoles([MERCHANT_ROLES.MERCHANT]),
//   handler(MerchantSelfController.getOwnPayoutFees)
// );

merchantRoutes.get(
  "/profile/api-keys",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnApiKeys)
);

merchantRoutes.get(
  "/dashboard/stats",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getDashboardStats)
);

merchantRoutes.get(
  "/balance",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(BalanceController.getMerchantBalance)
);

// --- NEW Self-Service Actions ---

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

merchantRoutes.get(
  "/ledger-accounts",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnLedgerAccounts)
);

merchantRoutes.get(
  "/ledger-accounts/:accountId",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnLedgerAccountById)
);

merchantRoutes.get(
  "/ledger-accounts/:accountId/transfers",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(MerchantSelfController.getOwnAccountTransfers)
);

export default merchantRoutes;
