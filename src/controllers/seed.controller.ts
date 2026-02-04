import { Context } from "hono";
import { faker } from "@faker-js/faker";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderModel } from "@/models/provider.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { generateCustomId } from "@/utils/id.util";
import { LedgerService } from "@/services/ledger/ledger.service";
import { paymentService } from "@/services/payment/payment.service";
import { LedgerAccountModel } from "@/models/ledger-account.model";
import { ok, err } from "@/utils/result";
import { InternalError } from "@/utils/error";
import { respond } from "@/utils/result-http";
import crypto from "crypto";
import argon2 from "argon2";

export class SeedController {
  async createTransaction(c: Context) {
    try {
      // 1. Ensure Merchant
      let merchant = await MerchantModel.findOne({
        email: "seed-merchant@example.com",
      });
      if (!merchant) {
        const mid = await generateCustomId("MID", "merchant");
        const hashedSecret = await argon2.hash("seed-secret");
        merchant = await MerchantModel.create({
          id: mid,
          name: "Seed Merchant",
          email: "seed-merchant@example.com",
          password: "password123", // Will be hashed by pre-save
          status: true,
          role: "MERCHANT",
          isOnboard: true,
          apiSecretEncrypted: hashedSecret,
          apiSecretEnabled: true,
          payin: {
            isActive: true,
            fees: [
              {
                fromAmount: 0,
                toAmount: -1,
                charge: { flat: 10, percentage: 2, taxRate: 18 },
              },
            ],
            tps: 100,
            dailyLimit: 1000000,
            isApiIpWhitelistEnabled: false,
            configType: "PAYIN",
          },
          payout: {
            isActive: true,
            fees: [
              {
                fromAmount: 0,
                toAmount: -1,
                charge: { flat: 5, percentage: 1, taxRate: 18 },
              },
            ],
            isApiIpWhitelistEnabled: false,
            configType: "PAYOUT",
          },
        });
        console.log("✅ Seed Merchant Created:", merchant.id);
      }

      // 2. Ensure Merchant TB Accounts
      const merchantAccounts = await LedgerAccountModel.find({
        ownerId: merchant.id,
      });
      if (merchantAccounts.length < 4) {
        console.log("🔌 Provisioning Merchant TB Accounts...");
        await LedgerService.createMerchantAccounts(merchant.id);
      }

      // 3. Ensure Provider
      let provider = await ProviderModel.findOne({ name: "Seed Provider" });
      if (!provider) {
        const pid = await generateCustomId("PRV", "provider");
        provider = await ProviderModel.create({
          id: pid,
          name: "Seed Provider",
          type: "PAYOUT", // or both
          status: true,
        });
        console.log("✅ Seed Provider Created:", provider.id);
      }

      // 4. Ensure Legal Entity
      let le = await LegalEntityModel.findOne({ alias: "Seed LE" });
      if (!le) {
        const leid = await generateCustomId("LE", "legal_entity");
        le = await LegalEntityModel.create({
          id: leid,
          name: "Seed Legal Entity",
          gst: "GST123456789",
          status: true,
        });
        console.log("✅ Seed Legal Entity Created:", le.id);
      }

      // 5. Ensure Provider Legal Entity (Channel)
      let ple = await ProviderLegalEntityModel.findOne({
        providerId: provider.id,
        legalEntityId: le.id,
      });
      if (!ple) {
        const pleId = await generateCustomId("PLE", "provider_legal_entity");
        ple = await ProviderLegalEntityModel.create({
          id: pleId,
          providerId: provider.id,
          legalEntityId: le.id,
          name: `Channel-${provider.name}-${le.name}`,
          status: true,
          isActive: true,
          credentials: { dummy: "creds" },
        });
        console.log("✅ Seed Channel Created:", ple.id);
      }

      // 6. Ensure Channel TB Accounts
      const pleAccounts = await LedgerAccountModel.find({ ownerId: ple.id });
      if (pleAccounts.length < 6) {
        console.log("🔌 Provisioning Channel TB Accounts...");
        await LedgerService.createProviderLegalEntityAccounts(ple.id);
      }

      // 7. Ensure Routing
      // 7. Ensure Routing
      if (
        merchant.payin.routing?.providerId !== provider.id ||
        merchant.payin.routing?.legalEntityId !== le.id
      ) {
        if (!merchant.payin.routing) merchant.payin.routing = {} as any;
        merchant.payin.routing!.providerId = provider.id;
        merchant.payin.routing!.legalEntityId = le.id;

        if (!merchant.payout.routing) merchant.payout.routing = {} as any;
        merchant.payout.routing!.providerId = provider.id;
        merchant.payout.routing!.legalEntityId = le.id;

        merchant.markModified("payin");
        merchant.markModified("payout");

        await merchant.save();
        console.log("✅ Merchant Routing Updated");
      }

      // 8. Create Transaction
      const amount = parseFloat(
        faker.finance.amount({ min: 100, max: 5000, dec: 2 })
      );
      const orderId = "ORD-" + faker.string.alphanumeric(10).toUpperCase();

      // Generate Hash
      // Hash format: amount|currency|externalOrderId|secret
      // Note: PaymentService expects 'INR' default if not provided
      const currency = "INR";
      const secret = "seed-secret"; // Use known secret
      const dataString = `${amount}|${currency}|${orderId}|${secret}`;
      const hash = crypto
        .createHmac("sha256", secret)
        .update(dataString)
        .digest("hex");

      const payload = {
        amount,
        currency,
        externalOrderId: orderId,
        customer: {
          name: faker.person.fullName(),
          email: faker.internet.email(),
          phone: faker.phone.number(),
        },
        hash,
      };

      console.log("🚀 Creating Seed Transaction...", payload);

      // We spoof the IP for whitelist check (if enabled, but we disabled it above)
      const txn = await paymentService.createPayin(
        merchant.id,
        payload,
        "127.0.0.1"
      );

      return respond(
        c,
        ok({
          message: "Transaction seeded successfully",
          transaction: txn,
          merchantId: merchant.id,
          providerId: provider.id,
          channelId: ple.id,
        })
      );
    } catch (error: any) {
      console.error("❌ Seed Error:", error);
      return respond(c, err(InternalError(error.message)));
    }
  }
}
