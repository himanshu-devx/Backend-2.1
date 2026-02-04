import { Hono } from "hono";
import adminManageRoutes from "./admin.routes";
import adminMerchantsRoutes from "./merchant.routes";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { panelIpWhitelistMiddleware } from "@/middlewares/panel-ip-whitelist.middleware";
import adminProviderLegalEntityRoutes from "./provider-legal-entity";
import adminProviderRoutes from "./provider.routes";
import adminLegalEntityRoutes from "./legal-entity.routes";
import adminMerchantBankAccountRoutes from "./merchant-bank-account.routes";
import { adminLedgerRoutes } from "./ledger.routes";
import { adminAnalyticsRoutes } from "./analytics.routes";

import { transferOperationRoutes } from "./transfer-operation.route";
import adminFilterRoutes from "./filter.routes";
const adminRoutes = new Hono();

adminRoutes.use(authMiddleware);
adminRoutes.use(panelIpWhitelistMiddleware);

adminRoutes.route("/merchants", adminMerchantsRoutes);
adminRoutes.route("/providers", adminProviderRoutes);
adminRoutes.route("/legal-entities", adminLegalEntityRoutes);
adminRoutes.route("/provider-legal-entity", adminProviderLegalEntityRoutes);
adminRoutes.route("/merchant-bank-accounts", adminMerchantBankAccountRoutes);
adminRoutes.route("/ledger", adminLedgerRoutes);
adminRoutes.route("/transfer-operations", transferOperationRoutes);
adminRoutes.route("/dashboard", adminAnalyticsRoutes);
adminRoutes.route("/filters", adminFilterRoutes);
adminRoutes.route("/", adminManageRoutes);

export default adminRoutes;
