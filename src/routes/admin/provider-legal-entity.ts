import { Hono } from "hono";
import { ProviderLegalEntityController } from "@/controllers/admin/provider-legal-entity.controller";
import { validateBody } from "@/middlewares/validate";
import {
  CreateProviderLegalEntitySchema,
  UpdateProviderServiceConfigSchema,
  AddProviderFeeTierSchema,
  DeleteProviderFeeTierSchema,
} from "@/dto/provider-legal-entity.dto";
import { authMiddleware } from "@/middlewares/auth.middleware";

const adminProviderRoutes = new Hono();
adminProviderRoutes.use("*", authMiddleware);

adminProviderRoutes.post(
  "/",
  validateBody(CreateProviderLegalEntitySchema),
  ProviderLegalEntityController.create
);
adminProviderRoutes.get("/", ProviderLegalEntityController.list);
adminProviderRoutes.get("/:id", ProviderLegalEntityController.getById);

// Payin Config & Fees
adminProviderRoutes.put(
  "/:id/payin",
  validateBody(UpdateProviderServiceConfigSchema),
  ProviderLegalEntityController.updatePayinConfig
);
adminProviderRoutes.post(
  "/:id/payin/fees",
  validateBody(AddProviderFeeTierSchema),
  ProviderLegalEntityController.addPayinFee
);
adminProviderRoutes.delete(
  "/:id/payin/fees",
  validateBody(DeleteProviderFeeTierSchema),
  ProviderLegalEntityController.deletePayinFee
);

// Payout Config & Fees
adminProviderRoutes.put(
  "/:id/payout",
  validateBody(UpdateProviderServiceConfigSchema),
  ProviderLegalEntityController.updatePayoutConfig
);
adminProviderRoutes.post(
  "/:id/payout/fees",
  validateBody(AddProviderFeeTierSchema),
  ProviderLegalEntityController.addPayoutFee
);
adminProviderRoutes.delete(
  "/:id/payout/fees",
  validateBody(DeleteProviderFeeTierSchema),
  ProviderLegalEntityController.deletePayoutFee
);

export default adminProviderRoutes;
