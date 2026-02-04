import { Hono } from "hono";
import { ProviderController } from "@/controllers/admin/provider.controller";
import { validateBody } from "@/middlewares/validate";
import { CreateProviderSchema, UpdateProviderSchema } from "@/dto/provider.dto";
import { authMiddleware, authorizeRoles } from "@/middlewares/auth.middleware";
import { ADMIN_ROLES } from "@/constants/users.constant";

const adminProviderRoutes = new Hono();

adminProviderRoutes.use(
  "*",
  authMiddleware,
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN])
);

adminProviderRoutes.post(
  "/",
  validateBody(CreateProviderSchema),
  ProviderController.create
);

adminProviderRoutes.get("/", ProviderController.list);

adminProviderRoutes.get("/:id", ProviderController.getById);

adminProviderRoutes.put(
  "/:id",
  validateBody(UpdateProviderSchema),
  ProviderController.update
);

export default adminProviderRoutes;
