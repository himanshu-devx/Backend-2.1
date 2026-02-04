import { LedgerAccountModel } from "@/models/ledger-account.model";
import { LedgerService } from "@/services/ledger/ledger.service";
import {
  ACCOUNT_TYPE,
  CURRENCY,
  OWNER_TYPE,
} from "@/constants/tigerbeetle.constant";
import { TRANSFER_OPERATION_CODES } from "@/constants/transfer-operation.constant";
import { ok, err, Result } from "@/utils/result";
import { AppError } from "@/utils/error";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import { ProviderModel } from "@/models/provider.model";
import { paisaToRupee } from "@/utils/currency.util";



/**
 * Helper to map transfer code to readable operation type
 */
function getTransferCodeDescription(code: number): string {
  // Transaction operation types
  switch (code) {
    case TRANSFER_OPERATION_CODES.PAYIN:
      return "PAYIN";
    case TRANSFER_OPERATION_CODES.PAYOUT:
      return "PAYOUT";
    case TRANSFER_OPERATION_CODES.INTERNAL_TRANSFER:
      return "INTERNAL_TRANSFER";
    case TRANSFER_OPERATION_CODES.MERCHANT_SETTLEMENT:
      return "MERCHANT_SETTLEMENT";
    case TRANSFER_OPERATION_CODES.MERCHANT_PAYOUT_FUND:
      return "MERCHANT_PAYOUT_FUND";
    case TRANSFER_OPERATION_CODES.MERCHANT_DEDUCT:
      return "MERCHANT_DEDUCT";
    case TRANSFER_OPERATION_CODES.MERCHANT_FEES:
      return "MERCHANT_FEES";
    case TRANSFER_OPERATION_CODES.MERCHANT_REFUND:
      return "MERCHANT_REFUND";
    case TRANSFER_OPERATION_CODES.MERCHANT_HOLD:
      return "MERCHANT_HOLD";
    case TRANSFER_OPERATION_CODES.MERCHANT_RELEASE:
      return "MERCHANT_RELEASE";
    case TRANSFER_OPERATION_CODES.PROVIDER_SETTLEMENT:
      return "PROVIDER_SETTLEMENT";
    case TRANSFER_OPERATION_CODES.PROVIDER_TOPUP:
      return "PROVIDER_TOPUP";
    case TRANSFER_OPERATION_CODES.PROVIDER_FEES:
      return "PROVIDER_FEES";
    case TRANSFER_OPERATION_CODES.PROVIDER_FEES_SETTLE:
      return "PROVIDER_FEES_SETTLE";
    case TRANSFER_OPERATION_CODES.INCOME_SETTLE:
      return "INCOME_SETTLE";

    // Currency codes (ISO 4217) - fallback for legacy transfers
    case CURRENCY.INR:
      return "INR";

    // Unknown codes
    default:
      return `OPERATION_${code}`;
  }
}

/**
 * Helper to calculate account balance from TB account
 */
function calculateAccountBalance(tbAccount: any) {
  const debitsPending = tbAccount ? Number(tbAccount.debits_pending) : 0;
  const debitsPosted = tbAccount ? Number(tbAccount.debits_posted) : 0;
  const creditsPending = tbAccount ? Number(tbAccount.credits_pending) : 0;
  const creditsPosted = tbAccount ? Number(tbAccount.credits_posted) : 0;

  // Calculate net balance (credits - debits)
  const netBalance = creditsPosted - debitsPosted;

  return {
    debitsPending: paisaToRupee(debitsPending),
    debitsPosted: paisaToRupee(debitsPosted),
    creditsPending: paisaToRupee(creditsPending),
    creditsPosted: paisaToRupee(creditsPosted),
    balance: paisaToRupee(netBalance),
  };
}


export class AccountManagerService {
  /**
   * Provisions accounts for a Merchant.
   * Calls LedgerService to create TB accounts, then persists maps to Mongo.
   */
  static async provisionMerchantAccounts(
    merchantId: string,
    merchantName?: string
  ): Promise<Result<any, AppError>> {
    try {
      const requiredTypes = [
        ACCOUNT_TYPE.MERCHANT_PAYIN.slug,
        ACCOUNT_TYPE.MERCHANT_PAYOUT.slug,
        ACCOUNT_TYPE.MERCHANT_HOLD.slug,
      ];

      // 0. Resolve Owner Name
      let name = merchantName;
      if (!name) {
        const merchant = await MerchantModel.findOne({ id: merchantId }).select("name");
        name = merchant?.name || `Merchant ${merchantId}`;
      }

      // 1. Check idempotency - search for existing mappings
      const existingAccounts = await LedgerAccountModel.find({
        ownerId: merchantId,
        ownerType: "MERCHANT",
        typeSlug: {
          $in: requiredTypes
        },
      });

      // If all 3 exist, we are good
      if (existingAccounts.length === 3) {
        return ok({
          message: "Accounts already fully provisioned",
          ids: existingAccounts.map((a) => a.accountId),
        });
      }

      // If partial existence, cleanup to allow clean retry (standard onboarding behavior)
      if (existingAccounts.length > 0) {
        await LedgerAccountModel.deleteMany({
          ownerId: merchantId,
          ownerType: "MERCHANT",
        });
      }

      // 2. Call Pure LedgerService to create accounts in TigerBeetle
      const ids = await LedgerService.createMerchantAccounts(merchantId);

      // 3. Persist to Mongo
      const accountsToSave = [
        {
          accountId: ids.payinId,
          ownerId: merchantId,
          ownerName: name,
          ownerType: "MERCHANT",
          typeSlug: ACCOUNT_TYPE.MERCHANT_PAYIN.slug,
          currency: CURRENCY.INR,
          isActive: true
        },
        {
          accountId: ids.payoutId,
          ownerId: merchantId,
          ownerName: name,
          ownerType: "MERCHANT",
          typeSlug: ACCOUNT_TYPE.MERCHANT_PAYOUT.slug,
          currency: CURRENCY.INR,
          isActive: true
        },
        {
          accountId: ids.holdId,
          ownerId: merchantId,
          ownerName: name,
          ownerType: "MERCHANT",
          typeSlug: ACCOUNT_TYPE.MERCHANT_HOLD.slug,
          currency: CURRENCY.INR,
          isActive: true
        },
      ];

      await LedgerAccountModel.insertMany(accountsToSave);

      // 4. Audit Log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_MERCHANT_ACCOUNTS",
        actorId: "SYSTEM", // TODO: Get from context if triggered by admin
        actorType: "SYSTEM",
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: {
          accountIds: accountsToSave.map(a => a.accountId),
          typeSlugs: accountsToSave.map(a => a.typeSlug)
        }
      });

      // 5. Return enriched metadata for the UI
      const enrichedAccounts = accountsToSave.map((acc) => ({
        accountId: acc.accountId,
        typeSlug: acc.typeSlug,
        name: acc.typeSlug
          .split(":")
          .slice(1)
          .join(" ")
          .toLowerCase()
          .replace(/\b\w/g, (char) => char.toUpperCase()), // e.g. "Payin Hold"
      }));

      return ok({ accounts: enrichedAccounts });
    } catch (e: any) {
      return err(
        new AppError(e.message || "Failed to provision merchant accounts")
      );
    }
  }

  static async provisionProviderLegalEntityAccounts(
    pleId: string
  ): Promise<Result<any, AppError>> {
    try {
      const requiredTypes = [
        ACCOUNT_TYPE.PROVIDER_PAYIN.slug,
        ACCOUNT_TYPE.PROVIDER_PAYOUT.slug,
        ACCOUNT_TYPE.PROVIDER_EXPENSE.slug,
      ];

      // 0. Resolve Name
      const ple = await ProviderLegalEntityModel.findOne({ id: pleId }).lean();
      let name = `PLE ${pleId}`;
      if (ple) {
        const [provider, le] = await Promise.all([
          ProviderModel.findOne({ id: ple.providerId }).select("name"),
          LegalEntityModel.findOne({ id: ple.legalEntityId }).select("name"),
        ]);
        const pName = provider?.name || ple.providerId;
        const lName = le?.name || ple.legalEntityId;
        name = `${pName} - ${lName}`;
      }

      // 1. Check idempotency
      const existingAccounts = await LedgerAccountModel.find({
        ownerId: pleId,
        ownerType: "PROVIDER_LEGAL_ENTITY",
        typeSlug: {
          $in: requiredTypes
        },
      });

      if (existingAccounts.length === 3) {
        return ok({
          message: "Accounts already fully provisioned",
          ids: existingAccounts.map((a) => a.accountId),
        });
      }

      // If partial, cleanup
      if (existingAccounts.length > 0) {
        await LedgerAccountModel.deleteMany({
          ownerId: pleId,
          ownerType: "PROVIDER_LEGAL_ENTITY",
        });
      }

      const ids = await LedgerService.createProviderLegalEntityAccounts(pleId);

      const accountsToSave = [
        {
          accountId: ids.payinId,
          ownerId: pleId,
          ownerName: name,
          ownerType: "PROVIDER_LEGAL_ENTITY",
          typeSlug: ACCOUNT_TYPE.PROVIDER_PAYIN.slug,
          currency: CURRENCY.INR,
          isActive: true
        },
        {
          accountId: ids.payoutId,
          ownerId: pleId,
          ownerName: name,
          ownerType: "PROVIDER_LEGAL_ENTITY",
          typeSlug: ACCOUNT_TYPE.PROVIDER_PAYOUT.slug,
          currency: CURRENCY.INR,
          isActive: true
        },
        {
          accountId: ids.expenseId,
          ownerId: pleId,
          ownerName: name,
          ownerType: "PROVIDER_LEGAL_ENTITY",
          typeSlug: ACCOUNT_TYPE.PROVIDER_EXPENSE.slug,
          currency: CURRENCY.INR,
          isActive: true
        },
      ];

      await LedgerAccountModel.insertMany(accountsToSave);

      // 4. Audit Log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_PROVIDER_ACCOUNTS",
        actorId: "SYSTEM",
        actorType: "SYSTEM",
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: pleId,
        metadata: {
          accountIds: accountsToSave.map(a => a.accountId),
          typeSlugs: accountsToSave.map(a => a.typeSlug)
        }
      });

      return ok({ ids });
    } catch (e: any) {
      return err(new AppError(e.message || "Failed to provision PLE accounts"));
    }
  }

  static async provisionLegalEntityAccount(
    leId: string
  ): Promise<Result<any, AppError>> {
    try {
      const existing = await LedgerAccountModel.findOne({
        ownerId: leId,
        ownerType: "LEGAL_ENTITY",
      });
      if (existing) return ok({ message: "Account already exists" });

      const le = await LegalEntityModel.findOne({ id: leId }).select("name");
      const name = le?.name || `LE ${leId}`;

      const id = await LedgerService.createLegalEntityAccount(leId);

      await LedgerAccountModel.create({
        accountId: id,
        ownerId: leId,
        ownerName: name,
        ownerType: "LEGAL_ENTITY",
        typeSlug: ACCOUNT_TYPE.LEGAL_ENTITY_MAIN.slug,
        currency: CURRENCY.INR,
        isActive: true
      });

      // Audit Log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_LEGAL_ENTITY_ACCOUNT",
        actorId: "SYSTEM",
        actorType: "SYSTEM",
        entityType: "LEGAL_ENTITY",
        entityId: leId,
        metadata: { accountId: id }
      });

      return ok({ id });
    } catch (e: any) {
      return err(new AppError(e.message || "Failed to provision LE account"));
    }
  }

  static async provisionSuperAdminAccount(
    adminId: string
  ): Promise<Result<any, AppError>> {
    try {
      const existing = await LedgerAccountModel.findOne({
        ownerId: adminId,
        ownerType: "SUPER_ADMIN",
      });
      if (existing) return ok({ message: "Account already exists" });

      const id = await LedgerService.createSuperAdminAccount(adminId);

      await LedgerAccountModel.create({
        accountId: id,
        ownerId: adminId,
        ownerName: "Super Admin",
        ownerType: "SUPER_ADMIN",
        typeSlug: ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug,
        currency: CURRENCY.INR,
        isActive: true
      });

      // Audit Log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_SUPER_ADMIN_ACCOUNT",
        actorId: "SYSTEM",
        actorType: "SYSTEM",
        entityType: "SUPER_ADMIN",
        entityId: adminId,
        metadata: { accountId: id }
      });

      return ok({ id });
    } catch (e: any) {
      return err(new AppError(e.message || "Failed to provision Super Admin account"));
    }
  }

  /**
   * Generic fetch: Get accounts with balances for any owner(s).
   */
  static async getAccountsByOwner(ownerId: string) {
    return this.getAccounts({ ownerId });
  }

  static async getMerchantAccounts(merchantId: string) {
    return this.getAccounts({ ownerId: merchantId, ownerType: "MERCHANT" });
  }

  static async getProviderLegalEntityAccounts(pleId: string) {
    return this.getAccounts({
      ownerId: pleId,
      ownerType: "PROVIDER",
    });
  }

  static async getLegalEntityAccounts(leId: string) {
    return this.getAccounts({ ownerId: leId, ownerType: "LEGAL_ENTITY" });
  }

  static async getAllMerchantAccounts() {
    return this.getAccounts({ ownerType: "MERCHANT" });
  }

  static async getAllProviderLegalEntityAccounts() {
    return this.getAccounts({ ownerType: "PROVIDER" });
  }

  static async getAllLegalEntityAccounts() {
    return this.getAccounts({ ownerType: "LEGAL_ENTITY" });
  }

  /**
   * Get (or Create) the singleton World Account ID.
   */
  static async getWorldAccountId(): Promise<string> {
    // Check if exists
    const account = await LedgerAccountModel.findOne({
      typeSlug: ACCOUNT_TYPE.WORLD.slug,
    });

    if (account) return account.accountId;

    // Create if not exists
    const id = await LedgerService.createWorldAccount();
    await LedgerAccountModel.create({
      accountId: id,
      ownerId: "WORLD",
      ownerName: "World (External)",
      ownerType: "SUPER_ADMIN", // Owned by System/Admin technically
      typeSlug: ACCOUNT_TYPE.WORLD.slug,
      currency: CURRENCY.INR,
      isActive: true,
    });

    return id;
  }

  /**
   * Get a single account by accountId with balance and owner details.
   */
  static async getAccountById(accountId: string) {
    const account = await LedgerAccountModel.findOne({ accountId }).lean();
    if (!account) return null;

    const balances = await LedgerService.getBalances([BigInt(accountId)]);
    const tbAccount = balances[0];

    // Resolve owner details
    const ownerDetailsMap = await this.resolveAccountDetails([accountId]);
    const ownerDetails = ownerDetailsMap.get(accountId);

    // Calculate net balance (credits - debits)
    const balance = calculateAccountBalance(tbAccount);

    return {
      ...account,
      balance,
      owner: ownerDetails || {
        ownerId: account.ownerId,
        ownerType: account.ownerType,
        ownerName: account.ownerName,
      },
    };
  }

  /**
   * Get all accounts by ownerType with balances.
   */
  static async getAccountsByType(
    ownerType: "MERCHANT" | "LEGAL_ENTITY" | "PROVIDER"
  ) {
    return this.getAccounts({ ownerType });
  }

  /**
   * Get accounts with balances and resolved Owner Names.
   */
  static async getAccountsWithDetails(filter: any = {}) {
    // 1. Fetch Accounts with Balances
    const accounts = await this.getAccountsWithFilter(filter);
    if (!accounts.length) return [];

    // 2. Aggregate IDs for Lookup
    const merchantIds = new Set<string>();
    const pleIds = new Set<string>();
    const leIds = new Set<string>();

    accounts.forEach((acc) => {
      if (acc.ownerType === "MERCHANT") merchantIds.add(acc.ownerId);
      if (acc.ownerType === "PROVIDER" || (acc.ownerType as string) === "PROVIDER_LEGAL_ENTITY") pleIds.add(acc.ownerId);
      if (acc.ownerType === "LEGAL_ENTITY") leIds.add(acc.ownerId);
    });

    // 3. Fetch Owners
    const merchants = await MerchantModel.find({
      id: { $in: [...merchantIds] },
    })
      .select("id name")
      .lean();

    const les = await LegalEntityModel.find({ id: { $in: [...leIds] } })
      .select("id name")
      .lean();

    // For PLEs, we need to resolve Provider and LE names
    let pleMap = new Map<string, string>(); // pleId -> "ProviderName - LEName"

    if (pleIds.size > 0) {
      const ples = await ProviderLegalEntityModel.find({
        id: { $in: [...pleIds] },
      })
        .select("id providerId legalEntityId")
        .lean();

      const provIds = [...new Set(ples.map((p) => p.providerId))];
      const pleLeIds = [...new Set(ples.map((p) => p.legalEntityId))];

      const [providers, pleLes] = await Promise.all([
        ProviderModel.find({ id: { $in: provIds } })
          .select("id name")
          .lean(),
        LegalEntityModel.find({ id: { $in: pleLeIds } })
          .select("id name")
          .lean(),
      ]);

      ples.forEach((ple) => {
        const pName =
          providers.find((p) => p.id === ple.providerId)?.name ||
          ple.providerId;
        const lName =
          pleLes.find((l) => l.id === ple.legalEntityId)?.name ||
          ple.legalEntityId;
        pleMap.set(ple.id, `${pName} - ${lName}`);
      });
    }

    // 4. Enrich Accounts
    return accounts.map((acc) => {
      let ownerName = "Unknown";
      if (acc.ownerType === "MERCHANT") {
        ownerName =
          merchants.find((m) => m.id === acc.ownerId)?.name ||
          `Merchant ${acc.ownerId}`;
      } else if (acc.ownerType === "LEGAL_ENTITY") {
        ownerName =
          les.find((l) => l.id === acc.ownerId)?.name || `LE ${acc.ownerId}`;
      } else if (acc.ownerType === "PROVIDER" || (acc.ownerType as string) === "PROVIDER_LEGAL_ENTITY") {
        ownerName = pleMap.get(acc.ownerId) || `PLE ${acc.ownerId}`;
      }

      return {
        ...acc,
        ownerName,
      };
    });
  }

  /**
   * Get accounts with custom filter.
   */
  static async getAccountsWithFilter(filter: any) {
    return this.getAccounts(filter);
  }

  private static async getAccounts(filter: any) {
    // 1. Get Metadata from Mongo
    const accounts = await LedgerAccountModel.find(filter).lean();
    if (!accounts.length) return [];

    const accountIds = accounts.map((a) => BigInt(a.accountId));

    // 2. Fetch Balances from TB
    const balances = await LedgerService.getBalances(accountIds);

    // 3. Resolve owner details
    const ownerDetailsMap = await this.resolveAccountDetails(
      accounts.map((a) => a.accountId)
    );

    // 4. Merge
    return accounts.map((account) => {
      const tbAccount = balances.find(
        (b) => b.id === BigInt(account.accountId)
      );
      const ownerDetails = ownerDetailsMap.get(account.accountId);

      const ownerInfo = ownerDetails || {
        ownerId: account.ownerId,
        ownerType: account.ownerType,
        ownerName: account.ownerName,
      };

      const balance = calculateAccountBalance(tbAccount);

      return {
        ...account,
        ownerName: ownerInfo.ownerName, // Add ownerName directly
        balance,
        // owner object removed as requested
      };
    });
  }

  /**
   * Fetches all TigerBeetle transfers for all accounts belonging to an owner.
   */
  static async getTransfersByOwner(ownerId: string) {
    // 1. Get all accounts for this owner
    const accounts = await LedgerAccountModel.find({ ownerId }).lean();
    return this.fetchAndFormatTransfers(accounts);
  }

  /**
   * Fetches all TigerBeetle transfers for a specific account.
   */
  static async getTransfersByAccountId(
    accountId: string,
    options?: {
      limit?: number;
      reversed?: boolean;
      timestampMin?: bigint;
      timestampMax?: bigint;
    }
  ) {
    const account = await LedgerAccountModel.findOne({ accountId }).lean();

    // Override the default query options if provided
    if (account) {
      const opts = options || {};

      // Default to Today IST if no dates provided
      if (!opts.timestampMin && !opts.timestampMax) {
        const { getTodayRangeIST } = await import("@/utils/date.util");
        const { start, end } = getTodayRangeIST();

        opts.timestampMin = BigInt(start.getTime()) * 1000000n;
        opts.timestampMax = BigInt(end.getTime()) * 1000000n;
      }

      const transfers = await LedgerService.queryTransfers({
        accountId,
        limit: opts.limit,
        reversed: opts.reversed,
        timestampMin: opts.timestampMin,
        timestampMax: opts.timestampMax,
      });

      // Collect all account IDs from transfers
      const allAccountIds = new Set<string>();
      transfers.forEach((t) => {
        allAccountIds.add(t.debit_account_id.toString());
        allAccountIds.add(t.credit_account_id.toString());
      });

      // Resolve account details
      const accountDetailsMap = await this.resolveAccountDetails([...allAccountIds]);

      // Format and enrich transfers
      return transfers.map((t) => {
        const debitId = t.debit_account_id.toString();
        const creditId = t.credit_account_id.toString();
        const debitDetails = accountDetailsMap.get(debitId);
        const creditDetails = accountDetailsMap.get(creditId);

        // Determine if this is a CREDIT or DEBIT from the perspective of the queried account
        const isCredit = creditId === accountId;
        const type = isCredit ? "CREDIT" : "DEBIT";

        const selfAccountId = isCredit ? creditId : debitId;
        const selfDetails = isCredit ? creditDetails : debitDetails;

        const counterpartyAccountId = isCredit ? debitId : creditId;
        const counterparty = isCredit ? debitDetails : creditDetails;

        // Flatten self details for base fields (removing potentially conflicting fields like id, createdAt)
        // We ensure accountId matches the queried account
        const { id, _id, createdAt, updatedAt, ...cleanSelfDetails } = selfDetails || {};

        return {
          ...cleanSelfDetails, // Spread self details at root
          accountId: accountId, // Ensure accountId is explicit

          id: t.id.toString(), // Transfer ID overrides any self ID
          type, // CREDIT = money in, DEBIT = money out
          amount: paisaToRupee(t.amount),

          counterparty: counterparty
            ? { ...counterparty, accountId: counterpartyAccountId }
            : { accountId: counterpartyAccountId },

          code: t.code,
          codeDescription: getTransferCodeDescription(t.code),
          flags: t.flags,
          timestamp: t.timestamp.toString(),
          createdAt: new Date(Number(t.timestamp / 1000000n)).toISOString(), // Transfer creation time
        };
      });
    }

    return this.fetchAndFormatTransfers(account ? [account] : [{ accountId } as any]);
  }

  /**
   * Fetches all transfers for a specific owner type (e.g., MERCHANT, LEGAL_ENTITY).
   */
  static async getTransfersByType(ownerType: string) {
    const accounts = await LedgerAccountModel.find({ ownerType }).lean();
    return this.fetchAndFormatTransfers(accounts);
  }

  /**
   * Private helper to fetch and format transfers given a list of Mongo account docs.
   */
  private static async fetchAndFormatTransfers(accounts: any[]) {
    if (!accounts.length) return [];

    // 2. Fetch transfers for each account using queryTransfers
    const transferPromises = accounts.map((acc) =>
      LedgerService.queryTransfers({
        accountId: acc.accountId,
        limit: 100,
        reversed: true, // Most recent first
      })
    );
    const allTransfersResults = await Promise.all(transferPromises);

    // 3. Flatten and identify unique transfers, collecting all account IDs
    const transferMap = new Map<string, any>();
    const allAccountIds = new Set<string>();

    allTransfersResults.flat().forEach((t) => {
      const idStr = t.id.toString();
      const debitId = t.debit_account_id.toString();
      const creditId = t.credit_account_id.toString();

      allAccountIds.add(debitId);
      allAccountIds.add(creditId);

      if (!transferMap.has(idStr)) {
        transferMap.set(idStr, {
          id: idStr,
          debitAccountId: debitId,
          creditAccountId: creditId,
          amount: paisaToRupee(t.amount),
          code: t.code,
          codeDescription: getTransferCodeDescription(t.code),
          flags: t.flags,
          timestamp: t.timestamp.toString(),
          createdAt: new Date(Number(t.timestamp / 1000000n)).toISOString(),
        });
      }
    });

    // 4. Resolve all account details (both sides of transfers)
    const accountDetailsMap = await this.resolveAccountDetails([...allAccountIds]);

    // 5. Enrich transfers with resolved account details
    const enrichedTransfers = Array.from(transferMap.values()).map((transfer) => {
      const debitDetails = accountDetailsMap.get(transfer.debitAccountId);
      const creditDetails = accountDetailsMap.get(transfer.creditAccountId);

      return {
        ...transfer,
        debit: debitDetails || { accountId: transfer.debitAccountId },
        credit: creditDetails || { accountId: transfer.creditAccountId },
      };
    });

    // 6. Sort by timestamp descending
    return enrichedTransfers.sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }

  /**
   * Resolves account details (ownerName, ownerType, typeSlug) for a list of accountIds.
   */
  static async resolveAccountDetails(accountIds: string[]) {
    if (!accountIds.length) return new Map<string, any>();

    const accounts = await LedgerAccountModel.find({
      accountId: { $in: accountIds },
    }).lean();

    const merchantIds = new Set<string>();
    const pleIds = new Set<string>();
    const leIds = new Set<string>();

    accounts.forEach((acc) => {
      if (acc.ownerType === "MERCHANT") merchantIds.add(acc.ownerId);
      if (acc.ownerType === "PROVIDER" || (acc.ownerType as string) === "PROVIDER_LEGAL_ENTITY") pleIds.add(acc.ownerId);
      if (acc.ownerType === "LEGAL_ENTITY") leIds.add(acc.ownerId);
      // SUPER_ADMIN doesn't need DB lookup usually as there is only one or we don't have a model yet
    });

    // Fetch Owners
    const merchants = merchantIds.size
      ? await MerchantModel.find({ id: { $in: [...merchantIds] } })
        .select("id name")
        .lean()
      : [];

    const les = leIds.size
      ? await LegalEntityModel.find({ id: { $in: [...leIds] } })
        .select("id name")
        .lean()
      : [];

    let pleMap = new Map<string, string>();
    if (pleIds.size > 0) {
      const ples = await ProviderLegalEntityModel.find({
        id: { $in: [...pleIds] },
      })
        .select("id providerId legalEntityId")
        .lean();

      const provIds = [...new Set(ples.map((p) => p.providerId))];
      const pleLeIds = [...new Set(ples.map((p) => p.legalEntityId))];

      const [providers, pleLes] = await Promise.all([
        ProviderModel.find({ id: { $in: provIds } })
          .select("id name")
          .lean(),
        LegalEntityModel.find({ id: { $in: pleLeIds } })
          .select("id name")
          .lean(),
      ]);

      ples.forEach((ple) => {
        const pName =
          providers.find((p) => p.id === ple.providerId)?.name ||
          ple.providerId;
        const lName =
          pleLes.find((l) => l.id === ple.legalEntityId)?.name ||
          ple.legalEntityId;
        pleMap.set(ple.id, `${pName} - ${lName}`);
      });
    }

    const resultMap = new Map<string, any>();
    accounts.forEach((acc) => {
      let ownerName = "Unknown";
      if (acc.ownerType === "MERCHANT") {
        ownerName =
          merchants.find((m) => m.id === acc.ownerId)?.name ||
          `Merchant ${acc.ownerId}`;
      } else if (acc.ownerType === "LEGAL_ENTITY") {
        ownerName =
          les.find((l) => l.id === acc.ownerId)?.name || `LE ${acc.ownerId}`;
      } else if (acc.ownerType === "PROVIDER" || (acc.ownerType as string) === "PROVIDER_LEGAL_ENTITY") {
        ownerName = pleMap.get(acc.ownerId) || `PLE ${acc.ownerId}`;
      } else if (acc.ownerType === "SUPER_ADMIN") {
        ownerName = "Super Admin";
      }

      resultMap.set(acc.accountId, {
        ownerId: acc.ownerId,
        ownerType: acc.ownerType,
        ownerName,
        typeSlug: acc.typeSlug,
      });
    });

    return resultMap;
  }
  /**
   * Batch fetch accounts and balances for a list of owners.
   * Returns a map of ownerId -> structured account details.
   */
  static async getAccountsForOwners(
    ownerIds: string[],
    ownerType: string
  ): Promise<Map<string, any>> {
    const validIds = ownerIds.filter((id) => id);
    if (!validIds.length) return new Map();

    // 1. Fetch all accounts for these owners
    const accounts = await LedgerAccountModel.find({
      ownerId: { $in: validIds },
      ownerType,
    }).lean();

    if (!accounts.length) return new Map();

    // 2. Collect all account IDs for TB fetch
    const allAccountIds = accounts.map((a) => BigInt(a.accountId));

    // 3. Fetch Balances from TigerBeetle
    let balances: any[] = [];
    try {
      balances = await LedgerService.getBalances(allAccountIds);
    } catch (e) {
      // Silent fail for enrichment
      // Fallback: continue with zero balances
    }

    // Map: AccountIDAsString -> { credits, debits }
    const rawBalanceMap = new Map<string, { credits: bigint; debits: bigint }>();
    balances.forEach((b) => {
      const credits = typeof b.credits_posted === 'bigint' ? b.credits_posted : BigInt(b.credits_posted || 0);
      const debits = typeof b.debits_posted === 'bigint' ? b.debits_posted : BigInt(b.debits_posted || 0);
      rawBalanceMap.set(b.id.toString(), { credits, debits });
    });

    // 4. Construct Result Map
    const resultMap = new Map<string, any>();

    accounts.forEach((acc) => {
      const ownerId = acc.ownerId;
      if (!resultMap.has(ownerId)) resultMap.set(ownerId, {});
      const entry = resultMap.get(ownerId);

      const raw = rawBalanceMap.get(acc.accountId) || { credits: 0n, debits: 0n };


      const slug = acc.typeSlug;

      const balance = raw.credits - raw.debits;

      let ledgerType = "LIABILITY";
      if (slug.startsWith("PROVIDER")) ledgerType = "ASSET";
      if (slug.includes("INCOME")) ledgerType = "REVENUE";

      const details = {
        accountId: acc.accountId,
        balance: paisaToRupee(balance),
        type: ledgerType
      };

      // Map based on slug suffix (Original + Legacy Support)
      // Merchant
      if (slug === ACCOUNT_TYPE.MERCHANT_PAYIN.slug || slug === "MERCHANT:PAYIN:AVAILABLE") entry.payin = details;
      else if (slug === ACCOUNT_TYPE.MERCHANT_PAYOUT.slug || slug === "MERCHANT:PAYOUT:AVAILABLE") entry.payout = details;
      else if (slug === ACCOUNT_TYPE.MERCHANT_HOLD.slug || slug.includes(":HOLD")) entry.hold = details; // Catch all holds

      // Legal Entity
      else if (slug === ACCOUNT_TYPE.LEGAL_ENTITY_MAIN.slug || slug === "LEGAL_ENTITY:AVAILABLE") entry.main = details;

      // Provider Legal Entity
      else if (slug === ACCOUNT_TYPE.PROVIDER_PAYIN.slug || slug === "PROVIDER:PAYIN:AVAILABLE") entry.payin = details;
      else if (slug === ACCOUNT_TYPE.PROVIDER_PAYOUT.slug || slug === "PROVIDER:PAYOUT:AVAILABLE") entry.payout = details;
      else if (slug === ACCOUNT_TYPE.PROVIDER_EXPENSE.slug || slug === "PROVIDER:EXPENSE" || slug.includes("COMMISSION")) entry.expense = details;
    });

    return resultMap;
  }
}
