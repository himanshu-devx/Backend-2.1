import { Hono } from "hono";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { validateBody, validateQuery } from "@/middlewares/validate";
import { MerchantBankAccountController } from "@/controllers/merchant/bank-account.controller";
import {
  CreateMerchantBankAccountSchema,
  UpdateMerchantBankAccountSchema,
  ListMerchantBankAccountSchema,
} from "@/dto/merchant-bank-account.dto";

const merchantBankAccountRoutes = new Hono();

merchantBankAccountRoutes.use("*", authMiddleware);

merchantBankAccountRoutes.post(
  "/",
  validateBody(CreateMerchantBankAccountSchema),
  MerchantBankAccountController.create
);

merchantBankAccountRoutes.get(
  "/",
  validateQuery(ListMerchantBankAccountSchema),
  MerchantBankAccountController.list
);

merchantBankAccountRoutes.put(
  "/:id",
  validateBody(UpdateMerchantBankAccountSchema),
  MerchantBankAccountController.update
);

export default merchantBankAccountRoutes;
