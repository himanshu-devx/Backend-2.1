import { AdminController } from "@/controllers";
import {
  CreateAdminSchema,
  LoginAdminSchema,
  VerifyOtpSchema,
  ForgotPasswordSchema,
  ConfirmResetPasswordSchema,
} from "@/dto/admin/admin.dto";
import { validateBody } from "@/middlewares/validate";
import { handler } from "@/utils/handler";
import { Hono } from "hono";

const adminAuthRoutes = new Hono();

adminAuthRoutes.post(
  "/create-super-admin",
  validateBody(CreateAdminSchema),
  handler(AdminController.createSuperAdmin)
);

adminAuthRoutes.post(
  "/login",
  validateBody(LoginAdminSchema),
  handler(AdminController.login)
);

adminAuthRoutes.post(
  "/verify-login-otp",
  validateBody(VerifyOtpSchema),
  handler(AdminController.verifyOtp)
);

adminAuthRoutes.post(
  "/forgot-password",
  validateBody(ForgotPasswordSchema),
  handler(AdminController.initiatePasswordReset)
);

adminAuthRoutes.post(
  "/confirm-reset-password",
  validateBody(ConfirmResetPasswordSchema),
  handler(AdminController.confirmResetPassword)
);

export default adminAuthRoutes;
