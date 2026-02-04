import { Hono } from "hono";
import { authMiddleware, authorizeRoles } from "@/middlewares/auth.middleware";
import { AdminLedgerController } from "@/controllers/admin/ledger.controller";
import { ADMIN_ROLES } from "@/constants/users.constant";

const adminLedgerRoutes = new Hono();

adminLedgerRoutes.use(authMiddleware);
adminLedgerRoutes.use(
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN])
);

adminLedgerRoutes.get(
  "/owner/:ownerId",
  AdminLedgerController.getOwnerAccounts
);
adminLedgerRoutes.get(
  "/account/:accountId",
  AdminLedgerController.getAccountById
);
adminLedgerRoutes.get(
  "/account/:accountId/transfers",
  AdminLedgerController.getAccountTransfers
);
adminLedgerRoutes.get("/type/:type", AdminLedgerController.getAccountsByType);

adminLedgerRoutes.get("/view", AdminLedgerController.getAccountsView);
adminLedgerRoutes.post("/transfer", AdminLedgerController.transferFunds);
adminLedgerRoutes.get("/transfers", AdminLedgerController.listTransfers);
adminLedgerRoutes.get(
  "/transfers/owner/:ownerId",
  AdminLedgerController.getTransfersByOwner
);

export { adminLedgerRoutes };
