/**
 * Settlement Job
 *
 * Handles automated settlement processing:
 * - Merchant payin to payout settlements
 * - Provider settlements
 * - Fee collection
 */

import { getPostgres } from "@/infra/postgres/connection";
import { PgLedgerService, LedgerAccount, OPERATION_CODES } from "@/services/ledger-pg/pg-ledger.service";
import { PgSettlementService } from "@/services/ledger-pg/pg-settlement.service";
import { paisaToRupee, rupeeToPaisa } from "@/services/ledger-pg/pg-account-manager.service";
import { logger } from "@/infra/logger-instance";
import { v4 as uuidv4 } from "uuid";

interface SettlementBatch {
  id: string;
  batch_number: string;
  batch_type: string;
  status: string;
  total_amount: bigint;
  total_transfers: number;
  successful_transfers: number;
  failed_transfers: number;
  metadata: Record<string, any>;
  error_details: Record<string, any>;
  initiated_by: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export async function runMerchantSettlementJob(): Promise<void> {
  const sql = getPostgres();
  const batchNumber = `MSETTL-${Date.now()}`;

  logger.info({ batchNumber }, "Starting merchant settlement job");

  // Create settlement batch record
  const [batch] = await sql<SettlementBatch[]>`
    INSERT INTO settlement_batches (
      batch_number,
      batch_type,
      status,
      initiated_by,
      started_at
    ) VALUES (
      ${batchNumber},
      'MERCHANT_SETTLEMENT',
      'PROCESSING',
      'SYSTEM',
      NOW()
    )
    RETURNING *
  `;

  try {
    // Find all merchants with positive payin balance
    const merchantAccounts = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE account_type = 'MERCHANT_PAYIN'
      AND is_active = TRUE
      AND (credits_posted - debits_posted) > 0
      ORDER BY owner_id
    `;

    let totalAmount = 0n;
    let successCount = 0;
    let failCount = 0;
    const errors: Record<string, string> = {};

    for (const payinAccount of merchantAccounts) {
      const balance = payinAccount.credits_posted - payinAccount.debits_posted;

      if (balance <= 0n) continue;

      try {
        // Get payout account
        const [payoutAccount] = await sql<LedgerAccount[]>`
          SELECT * FROM ledger_accounts
          WHERE owner_id = ${payinAccount.owner_id}
          AND account_type = 'MERCHANT_PAYOUT'
        `;

        if (!payoutAccount) {
          logger.warn(
            { merchantId: payinAccount.owner_id },
            "Merchant payout account not found, skipping"
          );
          continue;
        }

        // Create settlement transfer
        await PgLedgerService.createTransfer({
          debitAccountId: payinAccount.id,
          creditAccountId: payoutAccount.id,
          amount: balance,
          operationCode: OPERATION_CODES.MERCHANT_SETTLEMENT,
          operationName: "MERCHANT_SETTLEMENT",
          description: `Auto settlement batch ${batchNumber}`,
          metadata: { batchId: batch.id, batchNumber },
          actorId: "SYSTEM",
          actorType: "CRON_JOB",
        });

        // Record batch item
        await sql`
          INSERT INTO settlement_batch_items (
            batch_id,
            owner_id,
            amount,
            status,
            processed_at
          ) VALUES (
            ${batch.id},
            ${payinAccount.owner_id},
            ${balance},
            'SUCCESS',
            NOW()
          )
        `;

        totalAmount += balance;
        successCount++;

        logger.debug(
          {
            merchantId: payinAccount.owner_id,
            amount: paisaToRupee(balance),
          },
          "Merchant settled"
        );
      } catch (error: any) {
        failCount++;
        errors[payinAccount.owner_id] = error.message;

        // Record failed batch item
        await sql`
          INSERT INTO settlement_batch_items (
            batch_id,
            owner_id,
            amount,
            status,
            error_message,
            processed_at
          ) VALUES (
            ${batch.id},
            ${payinAccount.owner_id},
            ${balance},
            'FAILED',
            ${error.message},
            NOW()
          )
        `;

        logger.error(
          { merchantId: payinAccount.owner_id, error: error.message },
          "Failed to settle merchant"
        );
      }
    }

    // Update batch record
    await sql`
      UPDATE settlement_batches
      SET
        status = ${failCount === 0 ? "COMPLETED" : "COMPLETED_WITH_ERRORS"},
        total_amount = ${totalAmount},
        total_transfers = ${successCount + failCount},
        successful_transfers = ${successCount},
        failed_transfers = ${failCount},
        error_details = ${JSON.stringify(errors)},
        completed_at = NOW()
      WHERE id = ${batch.id}
    `;

    logger.info(
      {
        batchNumber,
        totalAmount: paisaToRupee(totalAmount),
        successCount,
        failCount,
      },
      "Merchant settlement job completed"
    );
  } catch (error: any) {
    // Mark batch as failed
    await sql`
      UPDATE settlement_batches
      SET
        status = 'FAILED',
        error_details = ${JSON.stringify({ error: error.message })},
        completed_at = NOW()
      WHERE id = ${batch.id}
    `;

    logger.error({ batchNumber, error }, "Merchant settlement job failed");
    throw error;
  }
}

export async function runProviderSettlementJob(): Promise<void> {
  const sql = getPostgres();
  const batchNumber = `PSETTL-${Date.now()}`;

  logger.info({ batchNumber }, "Starting provider settlement job");

  // Create settlement batch record
  const [batch] = await sql<SettlementBatch[]>`
    INSERT INTO settlement_batches (
      batch_number,
      batch_type,
      status,
      initiated_by,
      started_at
    ) VALUES (
      ${batchNumber},
      'PROVIDER_SETTLEMENT',
      'PROCESSING',
      'SYSTEM',
      NOW()
    )
    RETURNING *
  `;

  try {
    // Find all provider expense accounts with positive balance
    const expenseAccounts = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE account_type = 'PROVIDER_EXPENSE'
      AND is_active = TRUE
      AND (credits_posted - debits_posted) > 0
      ORDER BY owner_id
    `;

    // Get super admin income account
    let [incomeAccount] = await sql<LedgerAccount[]>`
      SELECT * FROM ledger_accounts
      WHERE owner_type = 'SUPER_ADMIN' AND account_type = 'SUPER_ADMIN_INCOME'
      LIMIT 1
    `;

    if (!incomeAccount) {
      // Create if doesn't exist
      const id = await PgLedgerService.createSuperAdminAccount("SYSTEM");
      incomeAccount = (await PgLedgerService.getAccount(id))!;
    }

    let totalAmount = 0n;
    let successCount = 0;
    let failCount = 0;
    const errors: Record<string, string> = {};

    for (const expenseAccount of expenseAccounts) {
      const balance = expenseAccount.credits_posted - expenseAccount.debits_posted;

      if (balance <= 0n) continue;

      try {
        // Settle expense to income
        await PgLedgerService.createTransfer({
          debitAccountId: expenseAccount.id,
          creditAccountId: incomeAccount.id,
          amount: balance,
          operationCode: OPERATION_CODES.PROVIDER_FEES_SETTLE,
          operationName: "PROVIDER_FEES_SETTLE",
          description: `Auto settlement batch ${batchNumber}`,
          metadata: { batchId: batch.id, batchNumber },
          actorId: "SYSTEM",
          actorType: "CRON_JOB",
        });

        // Record batch item
        await sql`
          INSERT INTO settlement_batch_items (
            batch_id,
            owner_id,
            amount,
            status,
            processed_at
          ) VALUES (
            ${batch.id},
            ${expenseAccount.owner_id},
            ${balance},
            'SUCCESS',
            NOW()
          )
        `;

        totalAmount += balance;
        successCount++;

        logger.debug(
          {
            pleId: expenseAccount.owner_id,
            amount: paisaToRupee(balance),
          },
          "Provider fees settled"
        );
      } catch (error: any) {
        failCount++;
        errors[expenseAccount.owner_id] = error.message;

        // Record failed batch item
        await sql`
          INSERT INTO settlement_batch_items (
            batch_id,
            owner_id,
            amount,
            status,
            error_message,
            processed_at
          ) VALUES (
            ${batch.id},
            ${expenseAccount.owner_id},
            ${balance},
            'FAILED',
            ${error.message},
            NOW()
          )
        `;

        logger.error(
          { pleId: expenseAccount.owner_id, error: error.message },
          "Failed to settle provider fees"
        );
      }
    }

    // Update batch record
    await sql`
      UPDATE settlement_batches
      SET
        status = ${failCount === 0 ? "COMPLETED" : "COMPLETED_WITH_ERRORS"},
        total_amount = ${totalAmount},
        total_transfers = ${successCount + failCount},
        successful_transfers = ${successCount},
        failed_transfers = ${failCount},
        error_details = ${JSON.stringify(errors)},
        completed_at = NOW()
      WHERE id = ${batch.id}
    `;

    logger.info(
      {
        batchNumber,
        totalAmount: paisaToRupee(totalAmount),
        successCount,
        failCount,
      },
      "Provider settlement job completed"
    );
  } catch (error: any) {
    await sql`
      UPDATE settlement_batches
      SET
        status = 'FAILED',
        error_details = ${JSON.stringify({ error: error.message })},
        completed_at = NOW()
      WHERE id = ${batch.id}
    `;

    logger.error({ batchNumber, error }, "Provider settlement job failed");
    throw error;
  }
}

export async function runExpiredTransferCleanupJob(): Promise<void> {
  logger.info("Starting expired transfer cleanup job");

  try {
    const voidedCount = await PgLedgerService.voidExpiredTransfers();

    logger.info({ voidedCount }, "Expired transfer cleanup job completed");
  } catch (error) {
    logger.error({ error }, "Expired transfer cleanup job failed");
    throw error;
  }
}
