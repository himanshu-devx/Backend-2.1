import { TransactionModel, TransactionStatus, type TransactionDocument } from "@/models/transaction.model";
import { NotFound, BadRequest } from "@/utils/error";
import { InitiatePayinDto } from "@/dto/payment/payin.dto";
import { InitiatePayoutDto } from "@/dto/payment/payout.dto";
import { mapTransactionAmountsToDisplay } from "@/utils/money.util";
import { getISTDate, getISTDayStart, getISTDayEnd, validateDateFormat } from "@/utils/date.util";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { MerchantCallbackService } from "@/services/payment/merchant-callback.service";
import { TransactionMonitorService } from "@/services/payment/transaction-monitor.service";
import type { ManualStatusUpdateDto } from "@/dto/payment/manual-status.dto";
import type { ManualStatusSyncDto } from "@/dto/payment/manual-status-sync.dto";
import type { ManualExpirePendingDto } from "@/dto/payment/manual-expire.dto";
import type { ManualProviderFeeSettlementDto } from "@/dto/payment/manual-provider-fee.dto";
import { CacheService } from "@/services/common/cache.service";
import { ProviderClient } from "@/services/provider-config/provider-client.service";
import { IST_OFFSET_MS } from "@/constants/common.constant";
import { TransactionType } from "@/constants/transaction.constant";
import { ProviderFeeSettlementService } from "@/services/provider-fee-settlement/provider-fee-settlement.service";
import type {
  PayinInitiateResponse,
  PayoutInitiateResponse,
} from "@/services/payment/payment.types";

export class PaymentService {
  async createPayin(
    merchant: any,
    data: InitiatePayinDto,
    requestIp: string
  ): Promise<PayinInitiateResponse> {
    const { PayinWorkflow } = await import("@/workflows/payin.workflow");
    const workflow = new PayinWorkflow(merchant, requestIp);
    return workflow.execute(data);
  }

  async createPayout(
    merchant: any,
    data: InitiatePayoutDto,
    requestIp: string
  ): Promise<PayoutInitiateResponse> {
    const { PayoutWorkflow } = await import("@/workflows/payout.workflow");
    const workflow = new PayoutWorkflow(merchant, requestIp);
    return workflow.execute(data);
  }

  async getStatus(merchantId: string, orderId: string) {
    const { StatusSyncWorkflow } = await import("@/workflows/status-sync.workflow");
    const { CacheService } = await import("@/services/common/cache.service");
    const { TpsService } = await import("@/services/common/tps.service");
    const { ENV } = await import("@/config/env");

    await TpsService.system("STATUS", ENV.SYSTEM_TPS, ENV.SYSTEM_TPS_WINDOW);
    const merchant = await CacheService.getMerchant(merchantId);
    if (merchant?.payin?.tps) {
      await TpsService.merchant(merchantId, "PAYIN", merchant.payin.tps);
    }

    const workflow = new StatusSyncWorkflow();
    const result = await workflow.execute(merchantId, orderId);
    const payload = (result as any)?.toObject ? (result as any).toObject() : result;
    return mapTransactionAmountsToDisplay(payload);
  }

  async getStatusByType(
    merchantId: string,
    orderId: string,
    type: "PAYIN" | "PAYOUT"
  ) {
    const { StatusSyncWorkflow } = await import("@/workflows/status-sync.workflow");
    const { CacheService } = await import("@/services/common/cache.service");
    const { TpsService } = await import("@/services/common/tps.service");
    const { ENV } = await import("@/config/env");

    await TpsService.system(type, ENV.SYSTEM_TPS, ENV.SYSTEM_TPS_WINDOW);
    const merchant = await CacheService.getMerchant(merchantId);
    if (type === "PAYIN" && merchant?.payin?.tps) {
      await TpsService.merchant(merchantId, "PAYIN", merchant.payin.tps);
    }
    if (type === "PAYOUT" && merchant?.payout?.tps) {
      await TpsService.merchant(merchantId, "PAYOUT", merchant.payout.tps);
    }

    const workflow = new StatusSyncWorkflow();
    const result = await workflow.execute(merchantId, orderId);
    const payload = (result as any)?.toObject ? (result as any).toObject() : result;
    return mapTransactionAmountsToDisplay(payload);
  }

  async manualStatusUpdate(data: ManualStatusUpdateDto, adminEmail: string) {
    const transaction = await TransactionModel.findOne({ orderId: data.orderId });
    if (!transaction) throw NotFound("Transaction not found");

    const updated = await this.applyManualStatusUpdate(transaction, data, adminEmail);
    return mapTransactionAmountsToDisplay(updated);
  }

  async manualStatusSync(data: ManualStatusSyncDto, adminEmail: string) {
    const transaction = await TransactionModel.findOne({ id: data.transactionId });
    if (!transaction) throw NotFound("Transaction not found");
    if (!transaction.providerLegalEntityId) throw NotFound("Provider channel not found");

    const ple = await CacheService.getChannelById(transaction.providerLegalEntityId);
    if (!ple) throw NotFound("Provider channel not found");

    const provider = await ProviderClient.getProviderForRouting(
      ple.providerId,
      ple.legalEntityId
    );

    const statusRequest = {
      transactionId: transaction.id,
      providerTransactionId: transaction.providerRef,
    };

    const result = await ProviderClient.execute(ple.id, "status", () => {
      if (transaction.type === "PAYOUT") {
        return provider.checkPayoutStatus(statusRequest);
      }
      return provider.checkPayinStatus(statusRequest);
    });

    const syncEvent = {
      type: "MANUAL_STATUS_SYNC",
      timestamp: getISTDate(),
      payload: {
        providerStatus: result?.status,
        providerMsg: result?.message,
        utr: result?.utr,
        providerTransactionId: transaction.providerRef,
        adminEmail,
        confirm: !!data.confirm,
      },
    };
    transaction.events = transaction.events || [];
    transaction.events.push(syncEvent as any);

    if (!result?.status || result.status === "PENDING") {
      await transaction.save();
      const payload = (transaction as any)?.toObject ? (transaction as any).toObject() : transaction;
      return mapTransactionAmountsToDisplay(payload);
    }

    const nextStatus: "SUCCESS" | "FAILED" =
      result.status === "SUCCESS" ? "SUCCESS" : "FAILED";

    const currentStatus = transaction.status;
    const terminalStatuses = new Set([
      TransactionStatus.SUCCESS,
      TransactionStatus.FAILED,
      TransactionStatus.REVERSED,
      TransactionStatus.EXPIRED,
    ]);

    const statusWouldChange = currentStatus !== nextStatus;
    const needsConfirmation = terminalStatuses.has(currentStatus) && statusWouldChange;

    if (needsConfirmation && !data.confirm) {
      await transaction.save();
      const payload = (transaction as any)?.toObject ? (transaction as any).toObject() : transaction;
      return {
        needsConfirmation: true,
        currentStatus,
        providerStatus: nextStatus,
        message: `Provider returned ${nextStatus} but transaction is ${currentStatus}. Confirm to update.`,
        transaction: mapTransactionAmountsToDisplay(payload),
      };
    }

    if (!statusWouldChange) {
      await transaction.save();
      const payload = (transaction as any)?.toObject ? (transaction as any).toObject() : transaction;
      return mapTransactionAmountsToDisplay(payload);
    }

    const updated = await this.applyManualStatusUpdate(transaction, {
      orderId: transaction.orderId,
      status: nextStatus,
      reason: result.message,
      utr: result.utr,
      providerMsg: result.message
    }, adminEmail);

    return mapTransactionAmountsToDisplay(updated);
  }

  async manualExpirePendingPreviousDay(data: ManualExpirePendingDto, adminEmail: string) {
    const dateStrInput = data?.date?.trim();
    if (dateStrInput && !validateDateFormat(dateStrInput)) {
      throw BadRequest("Invalid date format. Expected YYYY-MM-DD");
    }
    const { start, end, dateStr } = this.resolveExpireRange(dateStrInput);
    const reason = data?.reason || (dateStrInput
      ? `Expired pending for ${dateStr}`
      : "Expired previous day pending");

    const pendingTxns = await TransactionModel.find({
      status: { $in: [TransactionStatus.PENDING, TransactionStatus.PROCESSING] },
      type: TransactionType.PAYIN,
      createdAt: { $gte: start, $lte: end },
    });

    let updatedCount = 0;
    for (const txn of pendingTxns) {
      txn.status = TransactionStatus.EXPIRED;
      txn.error = reason;
      txn.events.push({
        type: "MANUAL_EXPIRE_PENDING_PREVIOUS_DAY",
        timestamp: getISTDate(),
        payload: { date: dateStr, reason, adminEmail }
      });
      await txn.save();

      MerchantCallbackService.notify(txn, { source: "MANUAL_EXPIRE" });
      updatedCount += 1;
    }

    return { date: dateStr, count: updatedCount };
  }

  async manualProviderFeeSettlement(data: ManualProviderFeeSettlementDto, _adminEmail: string) {
    const dateStr = data?.date?.trim();
    const effectiveDate = dateStr || this.resolveExpireRange().dateStr;

    if (dateStr && !validateDateFormat(dateStr)) {
      throw BadRequest("Invalid date format. Expected YYYY-MM-DD");
    }

    return ProviderFeeSettlementService.enqueueSettlementForDate(effectiveDate, {
      skipIfExists: true
    });
  }

  private async applyManualStatusUpdate(
    transaction: TransactionDocument,
    data: ManualStatusUpdateDto,
    adminEmail?: string
  ) {
    const metaGet = (key: string) => {
      if ((transaction.meta as any)?.get) return (transaction.meta as any).get(key);
      return (transaction.meta as any)?.[key];
    };
    const manualEntries = (metaGet("manualLedgerEntries") || []) as Array<{ id: string; action: string }>;
    const lastManualEntry = (actions: string[]) =>
      [...manualEntries].reverse().find((entry) => actions.includes(entry.action));

    const oldStatus = transaction.status;
    const newStatus = data.status as TransactionStatus;

    const hasExtraUpdates = !!(data.utr || data.providerTransactionId || data.providerMsg || data.reason);

    if (data.utr) transaction.utr = data.utr;
    if (data.providerTransactionId) transaction.providerRef = data.providerTransactionId;

    if (oldStatus === newStatus && !hasExtraUpdates) {
      return (transaction as any)?.toObject ? (transaction as any).toObject() : transaction;
    }

    const statusChanged = oldStatus !== newStatus;
    transaction.status = newStatus;
    if (newStatus === TransactionStatus.FAILED) {
      transaction.error = data.reason || "Manual status update";
    } else {
      transaction.error = undefined;
    }

    if (statusChanged && transaction.type === "PAYIN") {
      const ledgerEntryId = (transaction.meta as any)?.get
        ? (transaction.meta as any).get("ledgerEntryId")
        : (transaction.meta as any)?.ledgerEntryId;
      const ledgerReversed = (transaction.meta as any)?.get
        ? (transaction.meta as any).get("ledgerReversed")
        : (transaction.meta as any)?.ledgerReversed;

      if (newStatus === TransactionStatus.SUCCESS) {
        if (!ledgerEntryId || ledgerReversed) {
          await PaymentLedgerService.processPayinCredit(transaction, {
            manual: true,
            action: ledgerReversed ? "PAYIN_MANUAL_REPOST" : "PAYIN_MANUAL_CREDIT"
          });
        }
      }

      if (newStatus === TransactionStatus.FAILED) {
        if (ledgerEntryId && !ledgerReversed) {
          const manualCredit = lastManualEntry([
            "PAYIN_MANUAL_CREDIT",
            "PAYIN_MANUAL_REPOST"
          ]);
          const targetEntryId = manualCredit?.id || ledgerEntryId;
          await PaymentLedgerService.reverseEntry(transaction, targetEntryId, "PAYIN_MANUAL_REVERSE");
        }
      }
    }

    if (statusChanged && transaction.type === "PAYOUT") {
      const ledgerEntryId = (transaction.meta as any)?.get
        ? (transaction.meta as any).get("ledgerEntryId")
        : (transaction.meta as any)?.ledgerEntryId;
      const ledgerExecuted = (transaction.meta as any)?.get
        ? (transaction.meta as any).get("ledgerExecuted")
        : (transaction.meta as any)?.ledgerExecuted;
      const ledgerVoided = (transaction.meta as any)?.get
        ? (transaction.meta as any).get("ledgerVoided")
        : (transaction.meta as any)?.ledgerVoided;

      if (newStatus === TransactionStatus.SUCCESS) {
        if (ledgerVoided) {
          await PaymentLedgerService.manualPostPayout(transaction);
        } else if (!ledgerExecuted) {
          await PaymentLedgerService.commitPayout(transaction);
        }
      }

      if (newStatus === TransactionStatus.FAILED) {
        if (ledgerExecuted && ledgerEntryId) {
          const manualPost = lastManualEntry(["PAYOUT_MANUAL_POST"]);
          const targetEntryId = manualPost?.id || ledgerEntryId;
          await PaymentLedgerService.reverseEntry(transaction, targetEntryId, "PAYOUT_MANUAL_REVERSE");
        } else if (!ledgerVoided) {
          await PaymentLedgerService.voidPayout(transaction);
        }
      }
    }

    transaction.events.push({
      type: "MANUAL_STATUS_UPDATE",
      timestamp: getISTDate(),
      payload: {
        from: oldStatus,
        to: newStatus,
        reason: data.reason,
        utr: data.utr,
        providerTransactionId: data.providerTransactionId,
        providerMsg: data.providerMsg,
        adminEmail
      }
    });

    await transaction.save();

    if (transaction.type === "PAYOUT" && newStatus !== TransactionStatus.PENDING && newStatus !== TransactionStatus.PROCESSING) {
      await TransactionMonitorService.stopPayoutPolling(transaction.id);
    }

    MerchantCallbackService.notify(transaction, { source: "MANUAL_STATUS_UPDATE" });

    return (transaction as any)?.toObject ? (transaction as any).toObject() : transaction;
  }

  private resolveExpireRange(dateStrInput?: string) {
    if (dateStrInput) {
      return {
        start: getISTDayStart(dateStrInput),
        end: getISTDayEnd(dateStrInput),
        dateStr: dateStrInput
      };
    }

    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    const yesterdayIst = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
    const y = yesterdayIst.getUTCFullYear();
    const m = String(yesterdayIst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(yesterdayIst.getUTCDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    const start = getISTDayStart(dateStr);
    const end = getISTDayEnd(dateStr);
    return { start, end, dateStr };
  }
}

export const paymentService = new PaymentService();
