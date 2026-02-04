import { Hono } from "hono";
import { TransactionController } from "@/controllers";
import { handler } from "@/utils/handler";
import { validateQuery } from "@/middlewares/validate";
import { ListQuerySchema, TransactionListQuerySchema } from "@/dto/common.dto";
import { authMiddleware, authorizeRoles } from "@/middlewares/auth.middleware";
import { MERCHANT_ROLES } from "@/constants/users.constant";

const merchantTransactionRoutes = new Hono();

merchantTransactionRoutes.use("*", authMiddleware);

merchantTransactionRoutes.get(
  "/",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  validateQuery(TransactionListQuerySchema),
  handler(TransactionController.listMerchant)
);

merchantTransactionRoutes.get(
  "/:id",
  authorizeRoles([MERCHANT_ROLES.MERCHANT]),
  handler(TransactionController.getDetails)
);

export default merchantTransactionRoutes;
