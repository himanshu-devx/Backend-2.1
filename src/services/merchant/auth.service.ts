import { ok, err, Result } from "@/utils/result";
import {
  AppError,
  Conflict,
  HttpError,
  NotFound,
  Unauthorized,
} from "@/utils/error";

import { emailService } from "@/infra/email";
import { EmailTemplate } from "@/infra/email/templates";
import { ENV } from "@/config/env";
import { generateRandomPassword } from "@/utils/helper";

import { generateAuthToken } from "@/utils/jwt";
import {
  LoginMerchantDTO,
  RegisterMerchantDTO,
} from "@/dto/merchant/merchant.dto";
import { merchantRepository } from "@/repositories/merchant.repository";
import { adminRepository } from "@/repositories/admin.repository";
import { AuditService } from "@/services/common/audit.service";
import { AuditContext } from "@/utils/audit.util";
import { redis } from "@/infra/redis-instance";
import { RedisKeys } from "@/constants/redis.constant";
import { LoginHistoryService } from "@/services/common/login-history.service"; // Fixed path
import { LoginStatus, ActorType } from "@/models/login-history.model";
import { validateMerchantIp } from "@/utils/ip-validation.util";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { MerchantDocument } from "@/models/merchant.model";

export class MerchantService {
  static async registerMerchant(
    data: RegisterMerchantDTO,
    auditContext?: AuditContext
  ): Promise<Result<MerchantDocument, HttpError>> {
    const exists = await merchantRepository.findByEmail(data.email);
    if (exists) {
      return err(Conflict("Merchant already exists"));
    }

    const adminExists = await adminRepository.findByEmail(data.email);
    if (adminExists) {
      return err(Conflict("Email is already registered as an Admin/Staff account."));
    }

    const { generateCustomId } = await import("@/utils/id.util");
    (data as any).id = await generateCustomId("MID", "merchant");

    const temporaryPassword = generateRandomPassword();
    data.password = temporaryPassword;
    const merchant = await merchantRepository.create(data);
    merchant.password = "-";

    let loginUrl = `${ENV.FRONTEND_URL}/login`;

    // Dynamic URL generation based on request origin
    if (auditContext?.origin) {
      const baseUrl = auditContext.origin.replace(/\/$/, "");
      loginUrl = `${baseUrl}/login`;
    }

    await emailService.sendTemplate(
      EmailTemplate.MERCHANT_WELCOME,
      merchant.email,
      {
        name: merchant.name,
        loginUrl: loginUrl,
        initialPassword: temporaryPassword,
        loginId: merchant.email,
        role: merchant.role,
      }
    );

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_REGISTER",
        actorType: "MERCHANT",
        actorName: data.email,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: { name: merchant.name },
      });
    }

    return ok(merchant);
  }

  static async login(
    data: LoginMerchantDTO,
    auditContext?: AuditContext
  ): Promise<
    Result<
      | { merchant: MerchantDocument; token: string }
      | { requireOtp: boolean; message: string },
      HttpError
    >
  > {
    const merchant = await merchantRepository.findByEmail(data.email);

    if (!merchant) {
      if (auditContext) {
        AuditService.record({
          action: "MERCHANT_LOGIN_FAILED",
          actorType: "UNKNOWN",
          actorName: data.email,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          requestId: auditContext.requestId,
          metadata: { reason: "user_not_found" },
        });

        LoginHistoryService.logAttempt({
          userType: ActorType.MERCHANT,
          email: data.email,
          ipAddress: auditContext.ipAddress || "unknown",
          userAgent: auditContext.userAgent || "unknown",
          status: LoginStatus.FAILED,
          failureReason: "User not found",
        });
      }
      return err(Unauthorized("Invalid credentials"));
    }

    await validateMerchantIp(merchant, {
      action: "LOGIN",
      auditContext,
    });

    if (!merchant.status) {
      if (auditContext) {
        await AuditService.record({
          action: "MERCHANT_LOGIN_FAILED",
          actorType: "MERCHANT",
          actorId: merchant.email,
          actorName: merchant.email,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          requestId: auditContext.requestId,
          metadata: { reason: "account__inactive" },
        });
      }
      return err(Unauthorized("Account is inactive."));
    }

    const passwordMatch = await merchant.comparePassword(data.password);

    if (!passwordMatch) {
      if (auditContext) {
        await AuditService.record({
          action: "MERCHANT_LOGIN_FAILED",
          actorType: "MERCHANT",
          actorId: merchant.email,
          actorName: merchant.email,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          requestId: auditContext.requestId,
          metadata: { reason: "password_mismatch" },
        });

        await LoginHistoryService.logAttempt({
          userId: merchant.id,
          userType: ActorType.MERCHANT,
          email: merchant.email,
          ipAddress: auditContext.ipAddress || "unknown",
          userAgent: auditContext.userAgent || "unknown",
          status: LoginStatus.FAILED,
          failureReason: "Invalid password",
        });
      }
      return err(Unauthorized("Invalid credentials"));
    }

    const deviceId = data.deviceId;
    const deviceKey = deviceId
      ? RedisKeys.DEVICE.MERCHANT(merchant.email, deviceId)
      : "";
    const isKnownDevice = deviceKey ? await redis.get(deviceKey) : false;

    if (!isKnownDevice) {
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const redisKey = RedisKeys.OTP.MERCHANT(merchant.email);
      await redis.setex(redisKey, 600, otpCode);

      try {
        await emailService.sendTemplate(
          EmailTemplate.OTP_VERIFICATION,
          merchant.email,
          {
            name: merchant.name,
            otp: otpCode,
          }
        );
        console.log(`[DEBUG] OTP email sent to ${merchant.email} `);
      } catch (error) {
        console.error(
          `[ERROR] Failed to send OTP email to ${merchant.email}: `,
          error
        );
      }

      if (auditContext) {
        await AuditService.record({
          action: "MERCHANT_LOGIN_OTP_SENT",
          actorType: "MERCHANT",
          actorId: merchant.email,
          ipAddress: auditContext.ipAddress,
          metadata: { deviceId: deviceId || "unknown" },
        });
      }

      return ok({
        requireOtp: true,
        message: "New device detected. OTP sent to email.",
      } as any);
    }

    const tokenPayload = {
      id: merchant.id,
      email: merchant.email,
      role: merchant.role,
    };
    const token = generateAuthToken(tokenPayload);
    merchant.password = "-";

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_LOGIN_SUCCESS",
        actorType: "MERCHANT",
        actorName: merchant.email,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: { method: "direct_known_device" },
      });

      LoginHistoryService.logAttempt({
        userId: merchant.id,
        userType: ActorType.MERCHANT,
        email: merchant.email,
        ipAddress: auditContext.ipAddress || "unknown",
        userAgent: auditContext.userAgent || "unknown",
        status: LoginStatus.SUCCESS,
        deviceId: deviceId,
        metadata: { method: "direct_known_device" },
      });
    }

    return ok({ merchant, token });
  }

  static async verifyLoginOtp(
    data: { email: string; otp: string; deviceId: string },
    auditContext?: AuditContext
  ): Promise<Result<{ merchant: MerchantDocument; token: string }, HttpError>> {
    const merchant = await merchantRepository.findByEmail(data.email);
    if (!merchant) return err(Unauthorized("Invalid request"));

    await validateMerchantIp(merchant, {
      action: "VERIFY_OTP",
      auditContext,
    });

    const redisKey = RedisKeys.OTP.MERCHANT(merchant.email);
    const storedOtp = await redis.get(redisKey);

    if (!storedOtp || storedOtp !== data.otp) {
      return err(Unauthorized("Invalid or Expired OTP"));
    }

    await redis.del(redisKey);

    if (data.deviceId) {
      const deviceKey = RedisKeys.DEVICE.MERCHANT(
        merchant.email,
        data.deviceId
      );
      await redis.setex(deviceKey, 30 * 24 * 60 * 60, "true");
    }

    const tokenPayload = {
      id: merchant.id,
      email: merchant.email,
      role: merchant.role,
    };
    const token = generateAuthToken(tokenPayload);

    if (auditContext) {
      await AuditService.record({
        action: "MERCHANT_LOGIN_SUCCESS",
        actorType: "MERCHANT",
        actorId: merchant.email,
        actorName: merchant.name,
        ipAddress: auditContext.ipAddress,
        metadata: { method: "otp_verified", deviceId: data.deviceId },
      });

      await LoginHistoryService.logAttempt({
        userId: merchant.id,
        userType: ActorType.MERCHANT,
        email: merchant.email,
        ipAddress: auditContext.ipAddress || "unknown",
        userAgent: auditContext.userAgent || "unknown",
        status: LoginStatus.SUCCESS,
        deviceId: data.deviceId,
        metadata: { method: "otp_verified" },
      });
    }

    return ok({ merchant, token });
  }

  static async initiatePasswordReset(
    email: string,
    origin?: string,
    auditContext?: AuditContext
  ): Promise<Result<void, HttpError>> {
    const merchant = await merchantRepository.findByEmail(email);
    if (!merchant) {
      return err(NotFound("Merchant account not found."));
    }

    await validateMerchantIp(merchant, {
      action: "PASSWORD_RESET",
      auditContext,
    });

    const resetToken = randomBytes(32).toString("hex");
    const redisKey = RedisKeys.PASSWORD_RESET.MERCHANT(resetToken);

    try {
      await redis.setex(redisKey, 3600, merchant.email);

      let baseUrl = ENV.FRONTEND_URL || ENV.APP_BASE_URL;
      if (origin) {
        baseUrl = origin.replace(/\/$/, "");
      }

      // Fallback if neither env var is set
      if (!baseUrl) {
        baseUrl = "http://localhost:3000";
      }

      const resetLink = `${baseUrl}/reset-password?token=${resetToken}&type=merchant`;

      console.log(
        `[DEBUG] Generated Reset Link for ${merchant.email}: ${resetLink}`
      );

      await emailService.sendTemplate(
        EmailTemplate.PASSWORD_RESET,
        merchant.email,
        {
          name: merchant.name,
          resetLink: resetLink,
        }
      );
    } catch (error: any) {
      console.error("[ERROR] Failed to process password reset (Redis/Email):", error);
      throw new AppError("Failed to initiate password reset. Please try again later.", {
        status: 500,
        details: error.message
      });
    }

    if (auditContext) {
      await AuditService.record({
        action: "MERCHANT_PASSWORD_RESET_INIT",
        actorType: "MERCHANT",
        actorId: email,
        entityType: "MERCHANT",
        entityId: merchant.id,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(undefined);
  }

  static async confirmPasswordReset(
    token: string,
    newPassword: string,
    auditContext?: AuditContext
  ): Promise<Result<void, HttpError>> {
    const redisKey = RedisKeys.PASSWORD_RESET.MERCHANT(token);
    const email = await redis.get(redisKey);

    if (!email) {
      return err(Unauthorized("Invalid or expired reset token."));
    }

    const merchant = await merchantRepository.findByEmail(email);
    if (!merchant) {
      return err(NotFound("Merchant account not found."));
    }

    const hashedPassword = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    const updatedMerchant = await merchantRepository.update(merchant.id, {
      password: hashedPassword,
    } as any);

    if (!updatedMerchant) {
      throw new AppError("Failed to update password.", { status: 500 });
    }

    await redis.del(redisKey);
    await redis.del(RedisKeys.MERCHANT_CONFIG.PROFILE(merchant.id));

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_PASSWORD_RESET_CONFIRM",
        actorType: "MERCHANT",
        actorId: email,
        entityType: "MERCHANT",
        entityId: merchant.id,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok(undefined);
  }
}
