import type { Context } from "hono";
import { respond } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import {
  LoginMerchantDTO,
  RegisterMerchantDTO,
} from "@/dto/merchant/merchant.dto";
import { MerchantService } from "@/services/merchant/auth.service";

export class MerchantController {
  static async registerMerchant(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as RegisterMerchantDTO;
    const result = await MerchantService.registerMerchant(body, ctx);
    return respond(c, result, { successStatus: 201 });
  }

  static async login(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as LoginMerchantDTO;
    const result = await MerchantService.login(body, ctx);
    return respond(c, result);
  }

  static async verifyOtp(c: Context) {
    const ctx = getAuditContext(c);
    const body = c.get("validatedBody") as any; // VerifyOtpDTO
    const result = await MerchantService.verifyLoginOtp(body, ctx);
    return respond(c, result);
  }

  static async initiatePasswordReset(c: Context) {
    const ctx = getAuditContext(c);
    const { email } = c.get("validatedBody") as { email: string };
    const origin = c.req.header("origin");
    const result = await MerchantService.initiatePasswordReset(email, origin, ctx);
    return respond(c, result, { successStatus: 202 });
  }

  static async confirmResetPassword(c: Context) {
    const ctx = getAuditContext(c);
    const { token, newPassword } = c.get("validatedBody") as {
      token: string;
      newPassword: string;
    };
    const result = await MerchantService.confirmPasswordReset(
      token,
      newPassword,
      ctx
    );
    return respond(c, result);
  }
}
