/**
 * PostgreSQL Settlement Service
 *
 * Handles settlement operations for merchants and providers.
 * This service manages fund movements between accounts for settlements,
 * fee collection, holds, and releases.
 */

import { getPostgres } from "@/infra/postgres/connection";
import {
  PgLedgerService,
  OPERATION_CODES,
  LedgerAccount,
  AccountType,
} from "./pg-ledger.service";
import { PgAccountManagerService, rupeeToPaisa, paisaToRupee } from "./pg-account-manager.service";
import { logger } from "@/infra/logger-instance";

export class PgSettlementService {
  /**
   * Settles merchant payin to payout (makes funds available for withdrawal)
   */
  static async settleMerchant(
    merchantId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);
    const payinAccount = accounts.find((a) => a.account_type === "MERCHANT_PAYIN");
    const payoutAccount = accounts.find((a) => a.account_type === "MERCHANT_PAYOUT");

    if (!payinAccount || !payoutAccount) {
      throw new Error(`Merchant ${merchantId} accounts not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: payinAccount.id,
      creditAccountId: payoutAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.MERCHANT_SETTLEMENT,
      operationName: "MERCHANT_SETTLEMENT",
      description: options?.description || `Settlement for merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info(
      { merchantId, amount, amountPaisa: amountPaisa.toString() },
      "Merchant settlement completed"
    );
  }

  /**
   * Funds merchant payout account from external source (World)
   */
  static async fundMerchantPayout(
    merchantId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const worldAccountId = await PgAccountManagerService.getWorldAccountId();
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);
    const payoutAccount = accounts.find((a) => a.account_type === "MERCHANT_PAYOUT");

    if (!payoutAccount) {
      throw new Error(`Merchant ${merchantId} payout account not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: worldAccountId,
      creditAccountId: payoutAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.MERCHANT_PAYOUT_FUND,
      operationName: "MERCHANT_PAYOUT_FUND",
      description: options?.description || `Payout funding for merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ merchantId, amount }, "Merchant payout funded");
  }

  /**
   * Deducts from merchant account (for penalties, chargebacks, etc.)
   */
  static async deductFromMerchant(
    merchantId: string,
    amount: number,
    accountType: "PAYIN" | "PAYOUT" = "PAYOUT",
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const worldAccountId = await PgAccountManagerService.getWorldAccountId();
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);

    const targetType: AccountType = accountType === "PAYIN" ? "MERCHANT_PAYIN" : "MERCHANT_PAYOUT";
    const sourceAccount = accounts.find((a) => a.account_type === targetType);

    if (!sourceAccount) {
      throw new Error(`Merchant ${merchantId} ${accountType} account not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: sourceAccount.id,
      creditAccountId: worldAccountId,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.MERCHANT_DEDUCT,
      operationName: "MERCHANT_DEDUCT",
      description: options?.description || `Deduction from merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ merchantId, amount, accountType }, "Merchant deduction completed");
  }

  /**
   * Collects fees from merchant to super admin income account
   */
  static async collectMerchantFees(
    merchantId: string,
    amount: number,
    feeType: string = "PLATFORM_FEE",
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const sql = getPostgres();

    // Get merchant payout account
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);
    const payoutAccount = accounts.find((a) => a.account_type === "MERCHANT_PAYOUT");

    if (!payoutAccount) {
      throw new Error(`Merchant ${merchantId} payout account not found`);
    }

    // Get or create super admin income account
    let [incomeAccount] = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE owner_type = 'SUPER_ADMIN' AND account_type = 'SUPER_ADMIN_INCOME'
      LIMIT 1
    `;

    if (!incomeAccount) {
      const id = await PgLedgerService.createSuperAdminAccount("SYSTEM");
      incomeAccount = (await PgLedgerService.getAccount(id))!;
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: payoutAccount.id,
      creditAccountId: incomeAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.MERCHANT_FEES,
      operationName: "MERCHANT_FEES",
      description: options?.description || `${feeType} for merchant ${merchantId}`,
      metadata: { ...options?.metadata, feeType },
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ merchantId, amount, feeType }, "Merchant fees collected");
  }

  /**
   * Processes refund (World to Merchant)
   */
  static async processRefund(
    merchantId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const worldAccountId = await PgAccountManagerService.getWorldAccountId();
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);
    const payinAccount = accounts.find((a) => a.account_type === "MERCHANT_PAYIN");

    if (!payinAccount) {
      throw new Error(`Merchant ${merchantId} payin account not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: worldAccountId,
      creditAccountId: payinAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.MERCHANT_REFUND,
      operationName: "MERCHANT_REFUND",
      description: options?.description || `Refund for merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ merchantId, amount }, "Refund processed");
  }

  /**
   * Holds merchant funds (moves to hold account)
   */
  static async holdMerchantFunds(
    merchantId: string,
    amount: number,
    sourceType: "PAYIN" | "PAYOUT" = "PAYOUT",
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);

    const sourceAccountType: AccountType = sourceType === "PAYIN" ? "MERCHANT_PAYIN" : "MERCHANT_PAYOUT";
    const sourceAccount = accounts.find((a) => a.account_type === sourceAccountType);
    const holdAccount = accounts.find((a) => a.account_type === "MERCHANT_HOLD");

    if (!sourceAccount || !holdAccount) {
      throw new Error(`Merchant ${merchantId} accounts not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: sourceAccount.id,
      creditAccountId: holdAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.MERCHANT_HOLD,
      operationName: "MERCHANT_HOLD",
      description: options?.description || `Hold funds for merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ merchantId, amount, sourceType }, "Merchant funds held");
  }

  /**
   * Releases held merchant funds
   */
  static async releaseMerchantFunds(
    merchantId: string,
    amount: number,
    destinationType: "PAYIN" | "PAYOUT" = "PAYOUT",
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);

    const destAccountType: AccountType = destinationType === "PAYIN" ? "MERCHANT_PAYIN" : "MERCHANT_PAYOUT";
    const holdAccount = accounts.find((a) => a.account_type === "MERCHANT_HOLD");
    const destAccount = accounts.find((a) => a.account_type === destAccountType);

    if (!holdAccount || !destAccount) {
      throw new Error(`Merchant ${merchantId} accounts not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: holdAccount.id,
      creditAccountId: destAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.MERCHANT_RELEASE,
      operationName: "MERCHANT_RELEASE",
      description: options?.description || `Release held funds for merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ merchantId, amount, destinationType }, "Merchant funds released");
  }

  /**
   * Settles provider to legal entity
   */
  static async settleProvider(
    pleId: string,
    leId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const pleAccounts = await PgLedgerService.getAccountsByOwner(pleId);
    const leAccounts = await PgLedgerService.getAccountsByOwner(leId);

    const plePayinAccount = pleAccounts.find((a) => a.account_type === "PROVIDER_PAYIN");
    const leMainAccount = leAccounts.find((a) => a.account_type === "LEGAL_ENTITY_MAIN");

    if (!plePayinAccount || !leMainAccount) {
      throw new Error(`Provider or Legal Entity accounts not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: plePayinAccount.id,
      creditAccountId: leMainAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.PROVIDER_SETTLEMENT,
      operationName: "PROVIDER_SETTLEMENT",
      description: options?.description || `Provider settlement ${pleId} to ${leId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ pleId, leId, amount }, "Provider settlement completed");
  }

  /**
   * Top up provider payout account from legal entity
   */
  static async topUpProvider(
    pleId: string,
    leId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const pleAccounts = await PgLedgerService.getAccountsByOwner(pleId);
    const leAccounts = await PgLedgerService.getAccountsByOwner(leId);

    const plePayoutAccount = pleAccounts.find((a) => a.account_type === "PROVIDER_PAYOUT");
    const leMainAccount = leAccounts.find((a) => a.account_type === "LEGAL_ENTITY_MAIN");

    if (!plePayoutAccount || !leMainAccount) {
      throw new Error(`Provider or Legal Entity accounts not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: leMainAccount.id,
      creditAccountId: plePayoutAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.PROVIDER_TOPUP,
      operationName: "PROVIDER_TOPUP",
      description: options?.description || `Provider top-up ${pleId} from ${leId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ pleId, leId, amount }, "Provider top-up completed");
  }

  /**
   * Records provider fees (moves to expense account)
   */
  static async recordProviderFees(
    pleId: string,
    amount: number,
    feeType: string = "PROVIDER_FEE",
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const accounts = await PgLedgerService.getAccountsByOwner(pleId);

    const payinAccount = accounts.find((a) => a.account_type === "PROVIDER_PAYIN");
    const expenseAccount = accounts.find((a) => a.account_type === "PROVIDER_EXPENSE");

    if (!payinAccount || !expenseAccount) {
      throw new Error(`Provider ${pleId} accounts not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: payinAccount.id,
      creditAccountId: expenseAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.PROVIDER_FEES,
      operationName: "PROVIDER_FEES",
      description: options?.description || `${feeType} for provider ${pleId}`,
      metadata: { ...options?.metadata, feeType },
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ pleId, amount, feeType }, "Provider fees recorded");
  }

  /**
   * Settles provider fees to super admin income
   */
  static async settleProviderFees(
    pleId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const sql = getPostgres();

    const pleAccounts = await PgLedgerService.getAccountsByOwner(pleId);
    const expenseAccount = pleAccounts.find((a) => a.account_type === "PROVIDER_EXPENSE");

    if (!expenseAccount) {
      throw new Error(`Provider ${pleId} expense account not found`);
    }

    // Get or create super admin income account
    let [incomeAccount] = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE owner_type = 'SUPER_ADMIN' AND account_type = 'SUPER_ADMIN_INCOME'
      LIMIT 1
    `;

    if (!incomeAccount) {
      const id = await PgLedgerService.createSuperAdminAccount("SYSTEM");
      incomeAccount = (await PgLedgerService.getAccount(id))!;
    }

    const amountPaisa = rupeeToPaisa(amount);

    await PgLedgerService.createTransfer({
      debitAccountId: expenseAccount.id,
      creditAccountId: incomeAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.PROVIDER_FEES_SETTLE,
      operationName: "PROVIDER_FEES_SETTLE",
      description: options?.description || `Provider fees settlement for ${pleId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info({ pleId, amount }, "Provider fees settled");
  }

  /**
   * Records a payin transaction (World -> Merchant Payin)
   */
  static async recordPayin(
    merchantId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
      isPending?: boolean;
      timeoutSeconds?: number;
    }
  ): Promise<string> {
    const worldAccountId = await PgAccountManagerService.getWorldAccountId();
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);
    const payinAccount = accounts.find((a) => a.account_type === "MERCHANT_PAYIN");

    if (!payinAccount) {
      throw new Error(`Merchant ${merchantId} payin account not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    const transfer = await PgLedgerService.createTransfer({
      debitAccountId: worldAccountId,
      creditAccountId: payinAccount.id,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.PAYIN,
      operationName: "PAYIN",
      description: options?.description || `Payin for merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
      isPending: options?.isPending,
      timeoutSeconds: options?.timeoutSeconds,
    });

    logger.info({ merchantId, amount, transferId: transfer.id }, "Payin recorded");

    return transfer.id;
  }

  /**
   * Records a payout transaction (Merchant Payout -> World)
   */
  static async recordPayout(
    merchantId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
      isPending?: boolean;
      timeoutSeconds?: number;
    }
  ): Promise<string> {
    const worldAccountId = await PgAccountManagerService.getWorldAccountId();
    const accounts = await PgLedgerService.getAccountsByOwner(merchantId);
    const payoutAccount = accounts.find((a) => a.account_type === "MERCHANT_PAYOUT");

    if (!payoutAccount) {
      throw new Error(`Merchant ${merchantId} payout account not found`);
    }

    const amountPaisa = rupeeToPaisa(amount);

    const transfer = await PgLedgerService.createTransfer({
      debitAccountId: payoutAccount.id,
      creditAccountId: worldAccountId,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.PAYOUT,
      operationName: "PAYOUT",
      description: options?.description || `Payout for merchant ${merchantId}`,
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
      isPending: options?.isPending,
      timeoutSeconds: options?.timeoutSeconds,
    });

    logger.info({ merchantId, amount, transferId: transfer.id }, "Payout recorded");

    return transfer.id;
  }

  /**
   * Internal transfer between any two accounts
   */
  static async internalTransfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    options?: {
      actorId?: string;
      actorType?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<string> {
    const amountPaisa = rupeeToPaisa(amount);

    const transfer = await PgLedgerService.createTransfer({
      debitAccountId: fromAccountId,
      creditAccountId: toAccountId,
      amount: amountPaisa,
      operationCode: OPERATION_CODES.INTERNAL_TRANSFER,
      operationName: "INTERNAL_TRANSFER",
      description: options?.description || "Internal transfer",
      metadata: options?.metadata,
      actorId: options?.actorId,
      actorType: options?.actorType,
    });

    logger.info(
      { fromAccountId, toAccountId, amount, transferId: transfer.id },
      "Internal transfer completed"
    );

    return transfer.id;
  }
}
