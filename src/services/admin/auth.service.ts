// src/services/admin.service.ts

import { ok, err, Result } from "@/utils/result";
import {
  AppError,
  Conflict,
  HttpError,
  NotFound,
  Unauthorized,
  BadRequest,
} from "@/utils/error";
import { adminRepository } from "@/repositories/admin.repository";
import { merchantRepository } from "@/repositories/merchant.repository";
import { CreateAdminDTO, LoginAdminDTO } from "@/dto/admin/admin.dto";
import { emailService } from "@/infra/email";
import { EmailTemplate } from "@/infra/email/templates";
import { ENV } from "@/config/env";
import { generateRandomPassword } from "@/utils/helper";

import { generateAuthToken } from "@/utils/jwt";
import { ListQueryDTO } from "@/dto/common.dto";
import { ADMIN_ROLES } from "@/constants/users.constant";
import { AuditService } from "@/services/common/audit.service";
import { AuditContext } from "@/utils/audit.util";
import { redis } from "@/infra/redis-instance";
import { RedisKeys } from "@/constants/redis.constant";
import { LoginHistoryService } from "@/services/common/login-history.service";
import { LoginStatus, ActorType } from "@/models/login-history.model";
import { validateAdminIp } from "@/utils/ip-validation.util";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { encryptSecret } from "@/utils/secret.util";
import crypto from "crypto"
import { getISTDate } from "@/utils/date.util";

export class AdminService {
  // --- 1. ACCOUNT CREATION ---

  static async createSuperAdmin(
    data: CreateAdminDTO,
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    try {
      const exists = await adminRepository.list();
      if (exists.data.length > 0) {
        return err(Conflict("Super Admin already exists"));
      }

      const merchantExists = await merchantRepository.findByEmail(data.email);
      if (merchantExists) {
        return err(Conflict("Email is already registered as a Merchant account."));
      }

      const temporaryPassword = generateRandomPassword();
      data.role = ADMIN_ROLES.SUPER_ADMIN;
      data.password = temporaryPassword;

      // Generate ID explicitly
      const { generateCustomId } = await import("@/utils/id.util");
      (data as any).id = await generateCustomId("ADM", "admin");

      const admin = await adminRepository.create(data as any);
      admin.password = "-";

      // Create World and Income System Accounts (one-time setup)
      let systemAccounts: any = null;
      try {
        const { AccountService } = await import("@/services/ledger/account.service");
        systemAccounts = await AccountService.createWorldAccounts(
          admin.email // Use super admin email as actor
        );

        // Verify both accounts were created
        if (!systemAccounts || !systemAccounts.world || !systemAccounts.income) {
          throw new Error("Failed to create system accounts (World/Income)");
        }

        console.log("[SUCCESS] Created system accounts:", {
          worldAccountId: systemAccounts.world.id,
          incomeAccountId: systemAccounts.income.id
        });
      } catch (error: any) {
        console.error("[ERROR] Failed to create system accounts during super admin setup:", error);
        // Note: We don't fail the super admin creation if system accounts fail
        // This allows manual retry of system account creation
        console.warn("[WARNING] Super admin created but system accounts failed. Please create them manually.");
      }

      await emailService.sendTemplate(
        EmailTemplate.ADMIN_WELCOME,
        admin.email,
        {
          name: admin.name,
          loginUrl: `${ENV.FRONTEND_URL}/admin/login`,
          initialPassword: temporaryPassword,
          loginId: admin.email,
          role: admin.role,
        }
      );
      console.log(
        `[DEBUG] Generated Password for ${admin.email}: ${temporaryPassword}`
      );

      try {
        await emailService.sendTemplate(
          EmailTemplate.ADMIN_WELCOME,
          admin.email,
          {
            name: admin.name,
            loginUrl: `${ENV.APP_BASE_URL}/admin/login`,
            initialPassword: temporaryPassword,
            loginId: admin.email,
            role: admin.role,
          }
        );
      } catch (error) {
        console.error(
          "[ERROR] Failed to send Super Admin Welcome email:",
          error
        );
        // Continue execution
      }

      if (auditContext) {
        AuditService.record({
          action: "ADMIN_CREATE_SUPER_ADMIN",
          actorType: "ADMIN",
          actorId: auditContext.actorEmail || "SYSTEM",
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          requestId: auditContext.requestId,
          metadata: {
            newAdminEmail: admin.email,
            systemAccountsCreated: systemAccounts ? true : false
          },
        });
      }

      return ok(admin);
    } catch (error) {
      console.log(error);
      return ok(error);
    }
  }

  static async createAdmin(
    data: CreateAdminDTO,
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    if (data.role === ADMIN_ROLES.SUPER_ADMIN) {
      return err(
        Conflict(
          "Super Admin role can only be created via the dedicated method."
        )
      );
    }
    const exists = await adminRepository.findByEmail(data.email);
    if (exists) {
      return err(Conflict("Admin already exists"));
    }

    const merchantExists = await merchantRepository.findByEmail(data.email);
    if (merchantExists) {
      return err(Conflict("Email is already registered as a Merchant account."));
    }

    const temporaryPassword = generateRandomPassword();

    if (!data.role) {
      data.role = ADMIN_ROLES.SUPPORT; // Default role
    }
    data.password = temporaryPassword;

    // Generate ID explicitly
    const { generateCustomId } = await import("@/utils/id.util");
    (data as any).id = await generateCustomId("ADM", "admin");

    const admin = await adminRepository.create(data as any);
    admin.password = "-";

    console.log(
      `[DEBUG] Generated Password for ${admin.email}: ${temporaryPassword}`
    );

    try {
      await emailService.sendTemplate(
        EmailTemplate.ADMIN_WELCOME,
        admin.email,
        {
          name: admin.name,
          loginUrl: `${ENV.APP_BASE_URL}/admin/login`,
          initialPassword: temporaryPassword,
          loginId: admin.email,
          role: admin.role,
        }
      );
    } catch (error) {
      console.error("[ERROR] Failed to send Admin Welcome email:", error);
      // Continue execution so the admin is created even if email fails
    }

    if (auditContext) {
      AuditService.record({
        action: "ADMIN_CREATE_ADMIN",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail, // The admin creating this account
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: { newAdminEmail: admin.email },
      });
    }

    return ok(admin);
  }

  // --- 2. AUTHENTICATION ---

  static async login(
    data: LoginAdminDTO,
    auditContext?: AuditContext
  ): Promise<Result<{ admin: any; token: string }, HttpError>> {
    try {
      const admin = await adminRepository.findByEmail(data.email);
      if (!admin) {
        if (auditContext) {
          AuditService.record({
            action: "ADMIN_LOGIN_FAILED",
            actorType: "UNKNOWN",
            actorName: data.email,
            ipAddress: auditContext.ipAddress,
            userAgent: auditContext.userAgent,
            requestId: auditContext.requestId,
            metadata: { reason: "user_not_found" },
          });

          // Log History (Fire and forget)
          LoginHistoryService.logAttempt({
            userType: ActorType.ADMIN,
            email: data.email,
            ipAddress: auditContext.ipAddress || "unknown",
            userAgent: auditContext.userAgent || "unknown",
            status: LoginStatus.FAILED,
            failureReason: "User not found",
          });
        }
        return err(Unauthorized("Invalid credentials"));
      }

      // --- IP Whitelist Check ---
      await validateAdminIp(admin, {
        action: "LOGIN",
        auditContext,
      });

      // Ensure admin is not logically deleted or inactive
      if (!admin.status) {
        if (auditContext) {
          await AuditService.record({
            action: "ADMIN_LOGIN_FAILED",
            actorType: "ADMIN",
            actorId: admin.email, // Use email as ID
            actorName: admin.name,
            ipAddress: auditContext.ipAddress,
            userAgent: auditContext.userAgent,
            requestId: auditContext.requestId,
            metadata: { reason: "account_inactive" },
          });
        }
        return err(Unauthorized("Account is inactive."));
      }

      const passwordMatch = await admin.comparePassword(data.password);

      if (!passwordMatch) {
        // ... logs ...
        return err(Unauthorized("Invalid credentials"));
      }

      // --- 2FA / Device Check Logic ---
      const deviceId = data.deviceId;

      console.log(`[DEBUG] Login Device Check: DeviceID='${deviceId}'`);

      // Fallback: If no deviceId provided, treat as "New Device" -> Force OTP
      const deviceKey = deviceId
        ? RedisKeys.DEVICE.ADMIN(admin.email, deviceId)
        : "";

      console.log(`[DEBUG] Generated Device Key: '${deviceKey}'`);

      const cachedDevice = deviceKey ? await redis.get(deviceKey) : null;
      const isKnownDevice = !!cachedDevice;

      console.log(`[DEBUG] Redis Result for Key:`, cachedDevice);
      console.log(`[DEBUG] Final isKnownDevice: ${isKnownDevice}`);

      // If new device, require OTP
      if (!isKnownDevice) {
        // Generate 6 digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // CRITICAL: Log OTP for debugging/blocked SMTP scenarios
        console.log(`[DEBUG] 🔐 Generated OTP for ${admin.email}: ${otpCode}`);

        const redisKey = RedisKeys.OTP.ADMIN(admin.email);
        await redis.setex(redisKey, 600, otpCode);
        try {
          await emailService.sendTemplate(
            EmailTemplate.OTP_VERIFICATION,
            admin.email,
            { name: admin.name, otp: otpCode }
          );
        } catch (error) { }

        return ok({
          requireOtp: true,
          message: "New device detected. OTP sent to email.",
        } as any);
      }

      // --- Known Device: Direct Login ---
      const tokenPayload = {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      };
      const token = generateAuthToken(tokenPayload);
      admin.password = "-";

      // ... Audit logs ...

      return ok({ admin, token });
    } catch (e: any) {
      console.error("LOGIN_ERROR:", e);
      return ok({ success: false, error: e.message, stack: e.stack } as any);
    }
  }

  static async verifyLoginOtp(
    data: { email: string; otp: string; deviceId: string },
    auditContext?: AuditContext
  ): Promise<Result<{ admin: any; token: string }, HttpError>> {
    const admin = await adminRepository.findByEmail(data.email);
    if (!admin) return err(Unauthorized("Invalid request"));

    // --- IP Whitelist Check ---
    await validateAdminIp(admin, {
      action: "VERIFY_OTP",
      auditContext,
    });

    // Check OTP
    const redisKey = RedisKeys.OTP.ADMIN(admin.email);
    const storedOtp = await redis.get(redisKey);

    console.log(
      `[DEBUG] Verify OTP for ${admin.email}. Received: '${data.otp}', Stored: '${storedOtp}'`
    );

    if (!storedOtp || storedOtp !== data.otp) {
      console.log(`[DEBUG] OTP Mismatch or Expired.`);
      return err(Unauthorized("Invalid or Expired OTP"));
    }

    // Success: Clear OTP + Add Device to Redis (30 days)
    await redis.del(redisKey);

    if (data.deviceId) {
      const deviceKey = RedisKeys.DEVICE.ADMIN(admin.email, data.deviceId);
      await redis.setex(deviceKey, 30 * 24 * 60 * 60, "true"); // 30 days
    }

    // Generate Token
    const tokenPayload = { id: admin.id, email: admin.email, role: admin.role };
    const token = generateAuthToken(tokenPayload);

    if (auditContext) {
      await AuditService.record({
        action: "ADMIN_LOGIN_SUCCESS",
        actorType: "ADMIN",
        actorId: admin.email,
        actorName: admin.name,
        ipAddress: auditContext.ipAddress,
        metadata: { method: "otp_verified", deviceId: data.deviceId },
      });

      // User Agent is missing in verifyLoginOtp params auditContext, assuming it's passed or defaults
      await LoginHistoryService.logAttempt({
        userId: admin.id,
        userType: ActorType.ADMIN,
        email: admin.email,
        ipAddress: auditContext.ipAddress || "unknown",
        userAgent: auditContext.userAgent || "unknown",
        status: LoginStatus.SUCCESS,
        deviceId: data.deviceId,
        metadata: { method: "otp_verified" },
      });
    }

    return ok({ admin, token });
  }

  // --- 3. DATA RETRIEVAL ---

  static async getAdminById(id: string): Promise<Result<any, HttpError>> {
    const keys = {
      profile: RedisKeys.ADMIN_CONFIG.PROFILE(id),
      apiKeys: RedisKeys.ADMIN_CONFIG.API_KEYS(id),
    };

    const cachedValues = await redis.mget(keys.profile, keys.apiKeys);
    const [cachedProfile, cachedApiKeys] = cachedValues;

    if (cachedProfile && cachedApiKeys) {
      try {
        const profile = JSON.parse(cachedProfile);
        const apiKeys = JSON.parse(cachedApiKeys);
        return ok({
          ...profile,
          ...apiKeys,
          id,
          _id: id,
        });
      } catch (e) {
        // ignore
      }
    }

    const admin = await adminRepository.findOne({ id: id });
    if (!admin) {
      return err(NotFound("Admin not found"));
    }
    admin.password = "-";
    const aData = admin.toJSON();

    const profileData = {
      name: aData.name,
      displayName: aData.displayName,
      email: aData.email,
      role: aData.role,
      status: aData.status,
      createdAt: aData.createdAt,
      updatedAt: aData.updatedAt,
    };

    const apiKeysData = {
      panelIpWhitelist: aData.panelIpWhitelist,
      isPanelIpWhitelistEnabled: aData.isPanelIpWhitelistEnabled,
    };

    await Promise.all([
      redis.setex(keys.profile, 3600, JSON.stringify(profileData)),
      redis.setex(keys.apiKeys, 3600, JSON.stringify(apiKeysData)),
    ]);

    return ok(admin);
  }

  static async getAdminList(
    queryOptions: ListQueryDTO & { role?: string; status?: string }
  ): Promise<Result<any, HttpError>> {
    const filter: any = {};
    if (queryOptions.role) {
      filter.role = queryOptions.role;
    }
    if (queryOptions.status) {
      if (queryOptions.status === "ACTIVE") filter.status = true;
      else if (queryOptions.status === "INACTIVE") filter.status = false;
    }

    const listResult = await adminRepository.list({
      ...queryOptions,
      filter,
      searchFields: ["name", "email"],
    });

    if (!listResult || !listResult.data) {
      throw new AppError("Failed to retrieve admin list from repository.", {
        status: 500,
      });
    }

    const sanitizedData = listResult.data.map((admin: any) => {
      if (admin.password) {
        admin.password = "-";
      }
      return admin;
    });

    return ok({ data: sanitizedData, meta: listResult.meta });
  }

  // --- 4. MANAGEMENT ACTIONS (UPDATE) ---

  static async toggleAdminStatus(
    adminId: string,
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    const admin = await adminRepository.findOne({ id: adminId });
    if (!admin) {
      return err(NotFound("Admin account not found."));
    }

    if (admin.role === ADMIN_ROLES.SUPER_ADMIN) {
      return err(
        Conflict(
          "Super Admin status can only be updated via the dedicated method."
        )
      );
    }

    const updatedAdmin = await adminRepository.update(
      admin._id as unknown as string,
      {
        status: !admin.status,
      } as any
    );

    if (!updatedAdmin) {
      throw new AppError("Failed to persist status change.", { status: 500 });
    }

    if (auditContext) {
      await AuditService.record({
        action: "ADMIN_TOGGLE_STATUS",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: { adminId: adminId, newStatus: !admin.status },
      });
    }

    // Invalidate Cache
    await redis.del(RedisKeys.ADMIN_CONFIG.PROFILE(adminId));

    updatedAdmin.password = "-";
    return ok(updatedAdmin);
  }

  static async updateAdminRole(
    adminId: string,
    newRole: any,
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    if (newRole === ADMIN_ROLES.SUPER_ADMIN) {
      return err(
        Conflict(
          "Super Admin role can only be updated via the dedicated method."
        )
      );
    }

    const admin = await adminRepository.findOne({ id: adminId });
    if (!admin) {
      return err(NotFound("Admin account not found."));
    }
    if (admin.role === ADMIN_ROLES.SUPER_ADMIN) {
      return err(
        Conflict(
          "Super Admin role can only be updated via the dedicated method."
        )
      );
    }

    const updatedAdmin = await adminRepository.update(
      admin._id as unknown as string,
      {
        role: newRole,
      } as any
    );

    if (!updatedAdmin) {
      throw new AppError("Failed to persist role change.", { status: 500 });
    }

    if (auditContext) {
      await AuditService.record({
        action: "ADMIN_UPDATE_ROLE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: { adminId: adminId, newRole: newRole },
      });
    }

    // Invalidate Cache
    await redis.del(RedisKeys.ADMIN_CONFIG.PROFILE(adminId));

    updatedAdmin.password = "-";
    return ok(updatedAdmin);
  }

  // --- 6. PASSWORD MANAGEMENT ---

  static async initiatePasswordReset(
    email: string,
    origin?: string,
    auditContext?: AuditContext
  ): Promise<Result<void, HttpError>> {
    const admin = await adminRepository.findByEmail(email);
    if (!admin) {
      return err(NotFound("Admin account not found."));
    }

    // --- IP Whitelist Check ---
    await validateAdminIp(admin, {
      action: "PASSWORD_RESET",
      auditContext,
    });

    // 1. Generate and store a secure, single-use token
    const resetToken = randomBytes(32).toString("hex");
    const redisKey = RedisKeys.PASSWORD_RESET.ADMIN(resetToken);

    try {
      // Store in Redis for 1 hour
      await redis.setex(redisKey, 3600, admin.email);

      // Determine Base URL: Dynamic Origin > ENV > Localhost
      let baseUrl = ENV.FRONTEND_URL;
      if (origin) {
        baseUrl = origin.replace(/\/$/, ""); // Remove trailing slash if present
      }
      if (!baseUrl) {
        baseUrl = "http://localhost:3000";
      }

      const resetLink = `${baseUrl}/reset-password?token=${resetToken}&type=admin`;

      // 2. Send the reset email
      console.log(
        `[DEBUG] Generated Reset Link for ${admin.email}: ${resetLink}`
      );

      await emailService.sendTemplate(
        EmailTemplate.PASSWORD_RESET,
        admin.email,
        {
          name: admin.name,
          resetLink: resetLink,
        }
      );
    } catch (error: any) {
      console.error("[ERROR] Failed to process password reset (Redis/Email):", error);
      // We return a 500 explicitly to show the user something went wrong
      throw new AppError("Failed to initiate password reset. Please try again later.", {
        status: 500,
        details: error.message
      });
    }



    if (auditContext) {
      await AuditService.record({
        action: "ADMIN_PASSWORD_RESET_INIT",
        actorType: "ADMIN",
        actorId: email,
        entityType: "ADMIN",
        entityId: admin.id,
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
    const redisKey = RedisKeys.PASSWORD_RESET.ADMIN(token);
    const email = await redis.get(redisKey);

    if (!email) {
      return err(Unauthorized("Invalid or expired reset token."));
    }

    const admin = await adminRepository.findByEmail(email);
    if (!admin) {
      return err(NotFound("Admin account not found."));
    }

    // Hash password before update
    const hashedPassword = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    // Update password
    const updatedAdmin = await adminRepository.update(
      admin._id as unknown as string,
      {
        password: hashedPassword,
      } as any
    );

    if (!updatedAdmin) {
      throw new AppError("Failed to update password.", { status: 500 });
    }

    // Delete token from Redis
    await redis.del(redisKey);

    if (auditContext) {
      await AuditService.record({
        action: "ADMIN_PASSWORD_RESET_CONFIRM",
        actorType: "ADMIN",
        actorId: email,
        entityType: "ADMIN",
        entityId: admin.id,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    await redis.del(RedisKeys.ADMIN_CONFIG.PROFILE(admin.id));

    return ok(undefined);
  }

  static async updateIpWhitelist(
    targetId: string,
    data: { panelIpWhitelist: string[]; isPanelIpWhitelistEnabled: boolean },
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    const admin = await adminRepository.findOne({ id: targetId });
    if (!admin) {
      return err(NotFound("Admin account not found."));
    }

    // Capture previous values for audit
    const previousValues = {
      panelIpWhitelist: admin.panelIpWhitelist,
      isPanelIpWhitelistEnabled: admin.isPanelIpWhitelistEnabled,
    };

    const updatedAdmin = await adminRepository.update(
      admin._id as unknown as string,
      {
        panelIpWhitelist: data.panelIpWhitelist,
        isPanelIpWhitelistEnabled: data.isPanelIpWhitelistEnabled,
      } as any
    );

    if (!updatedAdmin) {
      throw new AppError("Failed to update IP whitelist.", { status: 500 });
    }

    // Audit log with previous and new values
    if (auditContext) {
      await AuditService.record({
        action: "ADMIN_UPDATE_PANEL_IP_WHITELIST",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "ADMIN",
        entityId: targetId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: {
          previousValues,
          newValues: {
            panelIpWhitelist: data.panelIpWhitelist,
            isPanelIpWhitelistEnabled: data.isPanelIpWhitelistEnabled,
          },
        },
      });
    }

    // Invalidate Cache
    await redis.del(RedisKeys.ADMIN_CONFIG.API_KEYS(targetId));

    updatedAdmin.password = "-";
    return ok(updatedAdmin);
  }

  static async updateProfile(
    adminId: string,
    data: { displayName?: string; password?: string },
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    const admin = await adminRepository.findOne({ id: adminId });
    if (!admin) return err(NotFound("Admin not found"));

    const updates: any = {};
    if (data.displayName) updates.displayName = data.displayName;
    if (data.password) {
      updates.password = await argon2.hash(data.password, {
        type: argon2.argon2id,
      });
    }

    if (Object.keys(updates).length === 0) {
      return ok(admin); // Nothing to update
    }

    const updatedAdmin = await adminRepository.update(
      admin._id as unknown as string,
      updates
    );
    if (!updatedAdmin)
      throw new AppError("Failed to update profile", { status: 500 });

    if (auditContext) {
      await AuditService.record({
        action: "ADMIN_UPDATE_PROFILE",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "ADMIN",
        entityId: adminId,
        metadata: { updatedFields: Object.keys(updates) },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    // Invalidate Cache
    await redis.del(RedisKeys.ADMIN_CONFIG.PROFILE(adminId));

    updatedAdmin.password = "-";
    return ok(updatedAdmin);
  }



  static async onboardMerchant(
    merchantId: string,
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    const merchant = await merchantRepository.findOne({ id: merchantId });
    if (!merchant) {
      return err(NotFound("Merchant not found"));
    }

    if (merchant.isOnboard) {
      const { Conflict } = await import("@/utils/error");
      return err(
        Conflict(
          "Merchant is already onboarded. Onboarding is a one-time operation."
        )
      );
    }

    let createdAccounts: any = null;

    // Step 1: Create Ledger Accounts FIRST - if this fails, don't onboard
    try {
      const { AccountService } = await import("@/services/ledger/account.service");
      createdAccounts = await AccountService.createMerchantAccounts(
        merchant.id,
        merchant.name,
        auditContext?.actorEmail || "SYSTEM"
      );

      // Verify all accounts were created
      if (!createdAccounts || !createdAccounts.payin || !createdAccounts.payout || !createdAccounts.hold) {
        throw new Error("Failed to create all required ledger accounts");
      }
    } catch (error: any) {
      // If account creation fails, do NOT proceed with onboarding
      console.error("[ERROR] Failed to create ledger accounts during onboarding:", error);
      return err(BadRequest(
        `Failed to create ledger accounts: ${error.message || "Unknown error"}`
      ));
    }

    // Step 2: Update Merchant Flags ONLY after accounts are successfully created
    try {
      const updates: any = {};
      const payin = merchant.payin || {};
      payin.isActive = true;

      const payout = merchant.payout || {};
      payout.isActive = true;

      updates.payin = payin;
      updates.payout = payout;
      updates.isOnboard = true;

      const newSecret = "sk_" + crypto.randomBytes(24).toString("hex");
      updates.apiSecretEncrypted = encryptSecret(newSecret)
      updates.apiSecretUpdatedAt = getISTDate()
      updates.apiSecretEnabled = true

      // Store ledger account IDs in merchant model
      updates.accounts = {
        payinAccountId: createdAccounts.payin.id,
        payoutAccountId: createdAccounts.payout.id,
        holdAccountId: createdAccounts.hold.id,
      };

      await merchantRepository.update(
        merchant.id,
        updates
      );

      const { CacheService } = await import("@/services/common/cache.service");
      await CacheService.invalidateMerchant(merchantId);
    } catch (error: any) {
      console.error("[ERROR] Failed to update merchant status after account creation:", error);
      return err(BadRequest(
        `Ledger accounts created but failed to update merchant status: ${error.message || "Unknown error"}`
      ));
    }

    if (auditContext) {
      await AuditService.record({
        action: "MERCHANT_ONBOARD",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
        metadata: {
          accountsCreated: createdAccounts ? Object.keys(createdAccounts).length : 0
        },
      });
    }

    return ok({
      message: "Merchant onboarded successfully",
      accounts: createdAccounts,
    });
  }
  static async updateMerchantRouting(
    merchantId: string,
    type: "PAYIN" | "PAYOUT",
    routing: { providerId: string; legalEntityId: string },
    auditContext?: AuditContext
  ): Promise<Result<any, HttpError>> {
    const merchant = await merchantRepository.findOne({ id: merchantId });
    if (!merchant) return err(NotFound("Merchant not found"));

    // const field = type === "PAYIN" ? "payinRouting" : "payoutRouting";
    const previousValues =
      type === "PAYIN" ? merchant.payin.routing : merchant.payout.routing;

    // Optional: Validate Provider ID and Legal Entity ID exist?
    // Usually good practice, but skipping for now to keep it lightweight as requested.

    const updateKey = type === "PAYIN" ? "payin.routing" : "payout.routing";

    // Update routing
    await merchantRepository.update(merchant._id as unknown as string, {
      [updateKey]: routing,
    });

    if (auditContext) {
      AuditService.record({
        action: "MERCHANT_UPDATE_ROUTING",
        actorType: "ADMIN",
        actorId: auditContext.actorEmail,
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { type, previousValues, newValues: routing },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        requestId: auditContext.requestId,
      });
    }

    return ok({ message: "Routing updated successfully" });
  }
}
