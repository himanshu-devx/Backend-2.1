/**
 * PostgreSQL Account Manager Service
 *
 * High-level account management service that provides the same interface
 * as the TigerBeetle-based AccountManagerService for seamless migration.
 */

import { getPostgres } from "@/infra/postgres/connection";
import {
  PgLedgerService,
  LedgerAccount,
  LedgerTransfer,
  AccountBalance,
  OwnerType,
  AccountType,
  OPERATION_CODES,
} from "./pg-ledger.service";
import { ok, err, Result } from "@/utils/result";
import { AppError } from "@/utils/error";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import { ProviderModel } from "@/models/provider.model";
import { logger } from "@/infra/logger-instance";

// Currency conversion utilities
export function paisaToRupee(paisa: bigint | number): number {
  const value = typeof paisa === "bigint" ? Number(paisa) : paisa;
  return value / 100;
}

export function rupeeToPaisa(rupee: number): bigint {
  return BigInt(Math.round(rupee * 100));
}

// Account type slug mapping (for compatibility with existing code)
const ACCOUNT_TYPE_SLUG_MAP: Record<AccountType, string> = {
  MERCHANT_PAYIN: "MERCHANT:PAYIN",
  MERCHANT_PAYOUT: "MERCHANT:PAYOUT",
  MERCHANT_HOLD: "MERCHANT:HOLD",
  LEGAL_ENTITY_MAIN: "LEGAL_ENTITY:MAIN",
  PROVIDER_PAYIN: "PROVIDER:PAYIN",
  PROVIDER_PAYOUT: "PROVIDER:PAYOUT",
  PROVIDER_EXPENSE: "PROVIDER:EXPENSE",
  SUPER_ADMIN_INCOME: "SUPER_ADMIN:INCOME",
  WORLD_MAIN: "WORLD:MAIN",
};

// Helper to get operation code description
function getOperationDescription(code: number): string {
  const codeNames: Record<number, string> = {
    1: "PAYIN",
    2: "PAYOUT",
    3: "INTERNAL_TRANSFER",
    10: "MERCHANT_SETTLEMENT",
    11: "MERCHANT_PAYOUT_FUND",
    12: "MERCHANT_DEDUCT",
    13: "MERCHANT_FEES",
    14: "MERCHANT_REFUND",
    15: "MERCHANT_HOLD",
    16: "MERCHANT_RELEASE",
    20: "PROVIDER_SETTLEMENT",
    21: "PROVIDER_TOPUP",
    22: "PROVIDER_FEES",
    23: "PROVIDER_FEES_SETTLE",
    30: "INCOME_SETTLE",
  };
  return codeNames[code] || `OPERATION_${code}`;
}

// Format balance object for API responses
function formatBalance(balance: AccountBalance | null) {
  if (!balance) {
    return {
      debitsPending: 0,
      debitsPosted: 0,
      creditsPending: 0,
      creditsPosted: 0,
      balance: 0,
    };
  }

  return {
    debitsPending: paisaToRupee(balance.debitsPending),
    debitsPosted: paisaToRupee(balance.debitsPosted),
    creditsPending: paisaToRupee(balance.creditsPending),
    creditsPosted: paisaToRupee(balance.creditsPosted),
    balance: paisaToRupee(balance.netBalance),
  };
}

export class PgAccountManagerService {
  /**
   * Provisions accounts for a Merchant
   */
  static async provisionMerchantAccounts(
    merchantId: string,
    merchantName?: string
  ): Promise<Result<any, AppError>> {
    try {
      // Resolve owner name if not provided
      let name = merchantName;
      if (!name) {
        const merchant = await MerchantModel.findOne({ id: merchantId }).select("name");
        name = merchant?.name || `Merchant ${merchantId}`;
      }

      // Check if accounts already exist
      const existing = await PgLedgerService.getAccountsByOwner(merchantId);
      if (existing.length === 3) {
        return ok({
          message: "Accounts already fully provisioned",
          ids: existing.map((a) => a.id),
        });
      }

      // Create accounts
      const ids = await PgLedgerService.createMerchantAccounts(merchantId, name);

      // Audit log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_MERCHANT_ACCOUNTS",
        actorId: "SYSTEM",
        actorType: "SYSTEM",
        entityType: "MERCHANT",
        entityId: merchantId,
        metadata: { accountIds: [ids.payinId, ids.payoutId, ids.holdId] },
      });

      // Return enriched accounts for UI
      const enrichedAccounts = [
        { accountId: ids.payinId, typeSlug: "MERCHANT:PAYIN", name: "Payin" },
        { accountId: ids.payoutId, typeSlug: "MERCHANT:PAYOUT", name: "Payout" },
        { accountId: ids.holdId, typeSlug: "MERCHANT:HOLD", name: "Hold" },
      ];

      return ok({ accounts: enrichedAccounts });
    } catch (e: any) {
      logger.error({ error: e, merchantId }, "Failed to provision merchant accounts");
      return err(new AppError(e.message || "Failed to provision merchant accounts"));
    }
  }

  /**
   * Provisions accounts for a Provider Legal Entity
   */
  static async provisionProviderLegalEntityAccounts(
    pleId: string
  ): Promise<Result<any, AppError>> {
    try {
      // Resolve owner name
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

      // Check if accounts already exist
      const existing = await PgLedgerService.getAccountsByOwner(pleId);
      if (existing.length === 3) {
        return ok({
          message: "Accounts already fully provisioned",
          ids: existing.map((a) => a.id),
        });
      }

      // Create accounts
      const ids = await PgLedgerService.createProviderLegalEntityAccounts(pleId, name);

      // Audit log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_PROVIDER_ACCOUNTS",
        actorId: "SYSTEM",
        actorType: "SYSTEM",
        entityType: "PROVIDER_LEGAL_ENTITY",
        entityId: pleId,
        metadata: { accountIds: [ids.payinId, ids.payoutId, ids.expenseId] },
      });

      return ok({ ids });
    } catch (e: any) {
      logger.error({ error: e, pleId }, "Failed to provision PLE accounts");
      return err(new AppError(e.message || "Failed to provision PLE accounts"));
    }
  }

  /**
   * Provisions account for a Legal Entity
   */
  static async provisionLegalEntityAccount(
    leId: string
  ): Promise<Result<any, AppError>> {
    try {
      // Check if account already exists
      const existing = await PgLedgerService.findAccounts({
        ownerId: leId,
        ownerType: "LEGAL_ENTITY",
      });
      if (existing.length > 0) {
        return ok({ message: "Account already exists", id: existing[0].id });
      }

      // Resolve name
      const le = await LegalEntityModel.findOne({ id: leId }).select("name");
      const name = le?.name || `LE ${leId}`;

      // Create account
      const id = await PgLedgerService.createLegalEntityAccount(leId, name);

      // Audit log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_LEGAL_ENTITY_ACCOUNT",
        actorId: "SYSTEM",
        actorType: "SYSTEM",
        entityType: "LEGAL_ENTITY",
        entityId: leId,
        metadata: { accountId: id },
      });

      return ok({ id });
    } catch (e: any) {
      logger.error({ error: e, leId }, "Failed to provision LE account");
      return err(new AppError(e.message || "Failed to provision LE account"));
    }
  }

  /**
   * Provisions account for Super Admin
   */
  static async provisionSuperAdminAccount(
    adminId: string
  ): Promise<Result<any, AppError>> {
    try {
      // Check if account already exists
      const existing = await PgLedgerService.findAccounts({
        ownerId: adminId,
        ownerType: "SUPER_ADMIN",
      });
      if (existing.length > 0) {
        return ok({ message: "Account already exists", id: existing[0].id });
      }

      // Create account
      const id = await PgLedgerService.createSuperAdminAccount(adminId);

      // Audit log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "PROVISION_SUPER_ADMIN_ACCOUNT",
        actorId: "SYSTEM",
        actorType: "SYSTEM",
        entityType: "SUPER_ADMIN",
        entityId: adminId,
        metadata: { accountId: id },
      });

      return ok({ id });
    } catch (e: any) {
      logger.error({ error: e, adminId }, "Failed to provision Super Admin account");
      return err(new AppError(e.message || "Failed to provision Super Admin account"));
    }
  }

  /**
   * Gets or creates the singleton World Account ID
   */
  static async getWorldAccountId(): Promise<string> {
    return PgLedgerService.getWorldAccountId();
  }

  /**
   * Gets accounts by owner with balances
   */
  static async getAccountsByOwner(ownerId: string) {
    const accounts = await PgLedgerService.getAccountsByOwner(ownerId);
    return this.enrichAccountsWithBalances(accounts);
  }

  /**
   * Gets a single account by ID with balance and owner details
   */
  static async getAccountById(accountId: string) {
    const account = await PgLedgerService.getAccount(accountId);
    if (!account) return null;

    const balance = await PgLedgerService.getBalance(accountId);
    const ownerDetails = await this.resolveOwnerDetails(account);

    return {
      id: account.id,
      accountId: account.id,
      ownerId: account.owner_id,
      ownerType: account.owner_type,
      ownerName: ownerDetails?.ownerName || account.owner_name,
      typeSlug: ACCOUNT_TYPE_SLUG_MAP[account.account_type],
      currency: account.currency_code,
      isActive: account.is_active,
      balance: formatBalance(balance),
      owner: ownerDetails,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    };
  }

  /**
   * Gets accounts by owner type with balances
   */
  static async getAccountsByType(
    ownerType: "MERCHANT" | "LEGAL_ENTITY" | "PROVIDER_LEGAL_ENTITY"
  ) {
    const pgOwnerType: OwnerType = ownerType === "PROVIDER_LEGAL_ENTITY"
      ? "PROVIDER_LEGAL_ENTITY"
      : ownerType;

    const accounts = await PgLedgerService.getAccountsByOwnerType(pgOwnerType);
    return this.enrichAccountsWithBalances(accounts);
  }

  /**
   * Gets merchant accounts
   */
  static async getMerchantAccounts(merchantId: string) {
    return this.getAccountsByOwner(merchantId);
  }

  /**
   * Gets provider legal entity accounts
   */
  static async getProviderLegalEntityAccounts(pleId: string) {
    return this.getAccountsByOwner(pleId);
  }

  /**
   * Gets legal entity accounts
   */
  static async getLegalEntityAccounts(leId: string) {
    return this.getAccountsByOwner(leId);
  }

  /**
   * Gets all merchant accounts
   */
  static async getAllMerchantAccounts() {
    return this.getAccountsByType("MERCHANT");
  }

  /**
   * Gets all provider legal entity accounts
   */
  static async getAllProviderLegalEntityAccounts() {
    return this.getAccountsByType("PROVIDER_LEGAL_ENTITY");
  }

  /**
   * Gets all legal entity accounts
   */
  static async getAllLegalEntityAccounts() {
    return this.getAccountsByType("LEGAL_ENTITY");
  }

  /**
   * Gets transfers by owner
   */
  static async getTransfersByOwner(ownerId: string) {
    const accounts = await PgLedgerService.getAccountsByOwner(ownerId);
    return this.fetchAndFormatTransfers(accounts);
  }

  /**
   * Gets transfers by account ID
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
    // Convert timestamp options to Date if provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (options?.timestampMin) {
      startDate = new Date(Number(options.timestampMin / 1000000n));
    }
    if (options?.timestampMax) {
      endDate = new Date(Number(options.timestampMax / 1000000n));
    }

    // Default to today if no dates provided
    if (!startDate && !endDate) {
      const { getTodayRangeIST } = await import("@/utils/date.util");
      const { start, end } = getTodayRangeIST();
      startDate = start;
      endDate = end;
    }

    const transfers = await PgLedgerService.getTransfersByAccount(accountId, {
      limit: options?.limit || 100,
      startDate,
      endDate,
    });

    // Collect all account IDs
    const allAccountIds = new Set<string>();
    transfers.forEach((t) => {
      allAccountIds.add(t.debit_account_id);
      allAccountIds.add(t.credit_account_id);
    });

    // Resolve account details
    const accountDetailsMap = await this.resolveAccountDetails([...allAccountIds]);

    // Format transfers
    return transfers.map((t) => {
      const debitDetails = accountDetailsMap.get(t.debit_account_id);
      const creditDetails = accountDetailsMap.get(t.credit_account_id);

      const isCredit = t.credit_account_id === accountId;
      const type = isCredit ? "CREDIT" : "DEBIT";

      const selfDetails = isCredit ? creditDetails : debitDetails;
      const counterparty = isCredit ? debitDetails : creditDetails;
      const counterpartyAccountId = isCredit ? t.debit_account_id : t.credit_account_id;

      return {
        ...selfDetails,
        accountId,
        id: t.id,
        type,
        amount: paisaToRupee(t.amount),
        counterparty: counterparty
          ? { ...counterparty, accountId: counterpartyAccountId }
          : { accountId: counterpartyAccountId },
        code: t.operation_code,
        codeDescription: getOperationDescription(t.operation_code),
        flags: 0, // Not used in PG implementation
        timestamp: t.created_at.getTime().toString() + "000000",
        createdAt: t.created_at.toISOString(),
      };
    });
  }

  /**
   * Gets transfers by owner type
   */
  static async getTransfersByType(ownerType: string) {
    const accounts = await PgLedgerService.getAccountsByOwnerType(ownerType as OwnerType);
    return this.fetchAndFormatTransfers(accounts);
  }

  /**
   * Batch fetch accounts and balances for a list of owners
   */
  static async getAccountsForOwners(
    ownerIds: string[],
    ownerType: string
  ): Promise<Map<string, any>> {
    const validIds = ownerIds.filter((id) => id);
    if (!validIds.length) return new Map();

    const sql = getPostgres();

    // Fetch all accounts for these owners
    const accounts = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE owner_id = ANY(${validIds})
      AND owner_type = ${ownerType}
    `;

    if (!accounts.length) return new Map();

    // Fetch all balances at once
    const accountIds = accounts.map((a) => a.id);
    const balanceMap = await PgLedgerService.getBalances(accountIds);

    // Build result map
    const resultMap = new Map<string, any>();

    accounts.forEach((acc) => {
      const ownerId = acc.owner_id;
      if (!resultMap.has(ownerId)) resultMap.set(ownerId, {});
      const entry = resultMap.get(ownerId);

      const balance = balanceMap.get(acc.id);
      const netBalance = balance ? balance.netBalance : 0n;

      let ledgerType = "LIABILITY";
      if (acc.account_type.startsWith("PROVIDER")) ledgerType = "ASSET";
      if (acc.account_type.includes("INCOME")) ledgerType = "REVENUE";

      const details = {
        accountId: acc.id,
        balance: paisaToRupee(netBalance),
        type: ledgerType,
      };

      // Map based on account type
      if (acc.account_type === "MERCHANT_PAYIN") entry.payin = details;
      else if (acc.account_type === "MERCHANT_PAYOUT") entry.payout = details;
      else if (acc.account_type === "MERCHANT_HOLD") entry.hold = details;
      else if (acc.account_type === "LEGAL_ENTITY_MAIN") entry.main = details;
      else if (acc.account_type === "PROVIDER_PAYIN") entry.payin = details;
      else if (acc.account_type === "PROVIDER_PAYOUT") entry.payout = details;
      else if (acc.account_type === "PROVIDER_EXPENSE") entry.expense = details;
    });

    return resultMap;
  }

  /**
   * Resolves account details for a list of account IDs
   */
  static async resolveAccountDetails(accountIds: string[]) {
    if (!accountIds.length) return new Map<string, any>();

    const sql = getPostgres();

    const accounts = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE id = ANY(${accountIds})
    `;

    // Collect owner IDs by type
    const merchantIds = new Set<string>();
    const pleIds = new Set<string>();
    const leIds = new Set<string>();

    accounts.forEach((acc) => {
      if (acc.owner_type === "MERCHANT") merchantIds.add(acc.owner_id);
      if (acc.owner_type === "PROVIDER_LEGAL_ENTITY") pleIds.add(acc.owner_id);
      if (acc.owner_type === "LEGAL_ENTITY") leIds.add(acc.owner_id);
    });

    // Fetch owners from MongoDB
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

    // PLE name resolution
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
        const pName = providers.find((p) => p.id === ple.providerId)?.name || ple.providerId;
        const lName = pleLes.find((l) => l.id === ple.legalEntityId)?.name || ple.legalEntityId;
        pleMap.set(ple.id, `${pName} - ${lName}`);
      });
    }

    // Build result map
    const resultMap = new Map<string, any>();
    accounts.forEach((acc) => {
      let ownerName = "Unknown";
      if (acc.owner_type === "MERCHANT") {
        ownerName = merchants.find((m) => m.id === acc.owner_id)?.name || `Merchant ${acc.owner_id}`;
      } else if (acc.owner_type === "LEGAL_ENTITY") {
        ownerName = les.find((l) => l.id === acc.owner_id)?.name || `LE ${acc.owner_id}`;
      } else if (acc.owner_type === "PROVIDER_LEGAL_ENTITY") {
        ownerName = pleMap.get(acc.owner_id) || `PLE ${acc.owner_id}`;
      } else if (acc.owner_type === "SUPER_ADMIN") {
        ownerName = "Super Admin";
      } else if (acc.owner_type === "WORLD") {
        ownerName = "World (External)";
      }

      resultMap.set(acc.id, {
        ownerId: acc.owner_id,
        ownerType: acc.owner_type,
        ownerName,
        typeSlug: ACCOUNT_TYPE_SLUG_MAP[acc.account_type],
      });
    });

    return resultMap;
  }

  /**
   * Helper to enrich accounts with balances
   */
  private static async enrichAccountsWithBalances(accounts: LedgerAccount[]) {
    if (!accounts.length) return [];

    const accountIds = accounts.map((a) => a.id);
    const balanceMap = await PgLedgerService.getBalances(accountIds);
    const ownerDetailsMap = await this.resolveAccountDetails(accountIds);

    return accounts.map((account) => {
      const balance = balanceMap.get(account.id);
      const ownerDetails = ownerDetailsMap.get(account.id);

      return {
        id: account.id,
        accountId: account.id,
        ownerId: account.owner_id,
        ownerType: account.owner_type,
        ownerName: ownerDetails?.ownerName || account.owner_name,
        typeSlug: ACCOUNT_TYPE_SLUG_MAP[account.account_type],
        currency: account.currency_code,
        isActive: account.is_active,
        balance: formatBalance(balance || null),
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      };
    });
  }

  /**
   * Helper to resolve owner details for a single account
   */
  private static async resolveOwnerDetails(account: LedgerAccount) {
    const details = await this.resolveAccountDetails([account.id]);
    return details.get(account.id) || null;
  }

  /**
   * Helper to fetch and format transfers
   */
  private static async fetchAndFormatTransfers(accounts: LedgerAccount[]) {
    if (!accounts.length) return [];

    // Fetch transfers for each account
    const transferPromises = accounts.map((acc) =>
      PgLedgerService.getTransfersByAccount(acc.id, { limit: 100 })
    );
    const allTransfersResults = await Promise.all(transferPromises);

    // Deduplicate and collect account IDs
    const transferMap = new Map<string, any>();
    const allAccountIds = new Set<string>();

    allTransfersResults.flat().forEach((t) => {
      allAccountIds.add(t.debit_account_id);
      allAccountIds.add(t.credit_account_id);

      if (!transferMap.has(t.id)) {
        transferMap.set(t.id, {
          id: t.id,
          debitAccountId: t.debit_account_id,
          creditAccountId: t.credit_account_id,
          amount: paisaToRupee(t.amount),
          code: t.operation_code,
          codeDescription: getOperationDescription(t.operation_code),
          flags: 0,
          timestamp: t.created_at.getTime().toString() + "000000",
          createdAt: t.created_at.toISOString(),
        });
      }
    });

    // Resolve account details
    const accountDetailsMap = await this.resolveAccountDetails([...allAccountIds]);

    // Enrich transfers
    const enrichedTransfers = Array.from(transferMap.values()).map((transfer) => {
      const debitDetails = accountDetailsMap.get(transfer.debitAccountId);
      const creditDetails = accountDetailsMap.get(transfer.creditAccountId);

      return {
        ...transfer,
        debit: debitDetails || { accountId: transfer.debitAccountId },
        credit: creditDetails || { accountId: transfer.creditAccountId },
      };
    });

    // Sort by timestamp descending
    return enrichedTransfers.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}
