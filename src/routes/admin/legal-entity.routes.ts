console.log("LOADING LEGAL ENTITY ROUTES FILE");
import { Hono } from "hono";
import { LegalEntityController } from "@/controllers/admin/legal-entity.controller";
import { validateBody } from "@/middlewares/validate";
import { authMiddleware, authorizeRoles } from "@/middlewares/auth.middleware";
import { ADMIN_ROLES } from "@/constants/users.constant";
import { z } from "zod";

const adminLegalEntityRoutes = new Hono();

// INLINE SCHEMA TO BYPASS IMPORT ISSUES
const CreateLegalEntitySchema = z.object({
  name: z.string().min(1),
  identifier: z.string().min(1),
  gstin: z.string().optional(),
  bankAccount: z
    .object({
      accountNumber: z.string(),
      ifsc: z.string(),
      bankName: z.string(),
      beneficiaryName: z.string(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

const UpdateLegalEntitySchema = z.object({
  displayName: z.string().min(1).optional(),
  identifier: z.string().min(1).optional(),
  gstin: z.string().optional(),
  bankAccount: z
    .object({
      accountNumber: z.string(),
      ifsc: z.string(),
      bankName: z.string(),
      beneficiaryName: z.string(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

adminLegalEntityRoutes.use(
  "*",
  authMiddleware,
  authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN])
);

adminLegalEntityRoutes.post(
  "/",
  validateBody(CreateLegalEntitySchema),
  LegalEntityController.create
);

adminLegalEntityRoutes.get("/", LegalEntityController.list);

adminLegalEntityRoutes.get("/:id", LegalEntityController.getById);

adminLegalEntityRoutes.put(
  "/:id",
  validateBody(UpdateLegalEntitySchema),
  LegalEntityController.update
);

export default adminLegalEntityRoutes;
