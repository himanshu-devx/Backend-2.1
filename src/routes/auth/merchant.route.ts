import { MerchantController } from "@/controllers";
import {
  LoginMerchantSchema,
  RegisterMerchantSchema,
  VerifyOtpSchema,
  ForgotPasswordSchema,
  ConfirmResetPasswordSchema,
} from "@/dto/merchant/merchant.dto";
import { validateBody } from "@/middlewares/validate";
import { handler } from "@/utils/handler";
import { Hono } from "hono";

const merchantAuthRoutes = new Hono();

merchantAuthRoutes.post(
  "/register",
  validateBody(RegisterMerchantSchema),
  handler(MerchantController.registerMerchant)
);

merchantAuthRoutes.post(
  "/login",
  validateBody(LoginMerchantSchema),
  handler(MerchantController.login)
);

merchantAuthRoutes.post(
  "/verify-otp",
  validateBody(VerifyOtpSchema),
  handler(MerchantController.verifyOtp)
);

merchantAuthRoutes.post(
  "/forgot-password",
  validateBody(ForgotPasswordSchema),
  handler(MerchantController.initiatePasswordReset)
);

merchantAuthRoutes.post(
  "/confirm-reset-password",
  validateBody(ConfirmResetPasswordSchema),
  handler(MerchantController.confirmResetPassword)
);

export default merchantAuthRoutes;
