import {
  TransactionModel,
  TransactionDocument,
} from "@/models/transaction.model";
import { ListQueryDTO } from "@/dto/common.dto";
import { Result, ok, err } from "@/utils/result";
import { HttpError, NotFound, AppError, BadRequest, Conflict } from "@/utils/error";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderModel } from "@/models/provider.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { getShiftedISTDate, getISTDate } from "@/utils/date.util";
import { LedgerService } from "@/services/ledger/ledger.service";
import { TransactionStatus } from "@/models/transaction.model";
import { mapTransactionAmountsToDisplay } from "@/utils/money.util";
import { paymentService } from "@/services/payment/payment.service";
import { MerchantCallbackService } from "@/services/payment/merchant-callback.service";

export interface TransactionListFilter extends ListQueryDTO {
  merchantId?: string; // Kept for alias
  providerId?: string;
  legalEntityId?: string;
  type?: string;
  status?: string;
  orderId?: string;
  providerRef?: string;
  utr?: string;
  ledgerEntryId?: string;
  flags?: string; // comma-separated
  startDate?: string;
  endDate?: string;
  category?: "PAYIN" | "PAYOUT" | "OTHER";
  fields?: string; // Comma-separated fields for projection
}

export class TransactionService {
  private static buildLedgerEntryQuery(ledgerEntryId: string) {
    return {
      $or: [
        { "meta.ledgerEntryId": ledgerEntryId },
        { "meta.ledgerCommitEntryId": ledgerEntryId },
        { "meta.ledgerHoldEntryId": ledgerEntryId },
        { "meta.manualLedgerEntries.id": ledgerEntryId },
        { "meta.ledgerReverseEntryId": ledgerEntryId },
        { "meta.ledgerReverseEntryIds.reverseEntryId": ledgerEntryId },
        { "meta.ledgerReverseEntryIds.entryId": ledgerEntryId },
      ],
    };
  }

  /**
   * List transactions with dynamic filtering and pagination
   */
  static async list(
    filter: TransactionListFilter
  ): Promise<
    Result<
      {
        data: Partial<TransactionDocument>[];
        meta: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      },
      HttpError
    >
  > {
    const {
      page = 1,
      limit = 10,
      search,
      merchantId,
      providerId,
      legalEntityId,
      type,
      status,
      orderId,
      providerRef,
      utr,
      ledgerEntryId,
      sort,
      category,
      flags,
    } = filter;

    const query: any = {};

    if (providerId) query.providerId = providerId;
    if (merchantId) query.merchantId = merchantId;
    if (legalEntityId) query.legalEntityId = legalEntityId;
    if (utr) query.utr = utr;
    if (ledgerEntryId) {
      Object.assign(query, this.buildLedgerEntryQuery(ledgerEntryId));
    }

    // Category Filter overrides specific type filter if present
    if (category) {
      if (category === "PAYIN") {
        query.type = "PAYIN";
      } else if (category === "PAYOUT") {
        query.type = "PAYOUT";
      } else if (category === "OTHER") {
        query.type = { $nin: ["PAYIN", "PAYOUT"] };
      }
    } else if (type) {
      query.type = type;
    }

    if (status) query.status = status;
    if (orderId) query.orderId = orderId;
    if (providerRef) query.providerRef = providerRef;
    if (flags) {
      const flagList = flags
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      if (flagList.length > 0) {
        query.flags = { $in: flagList };
      }
    }

    if (filter.startDate || filter.endDate) {
      if (!filter.startDate || !filter.endDate) {
        return err(new AppError("Both startDate and endDate are required", { status: 400 }));
      }

      try {
        const { parseDateRangeToIST } = await import("@/utils/date.util");
        const dateRange = parseDateRangeToIST(filter.startDate, filter.endDate);
        query.createdAt = {
          $gte: dateRange.startDate,
          $lte: dateRange.endDate
        };
      } catch (error: any) {
        return err(new AppError(error.message || "Invalid date format. Expected YYYY-MM-DD", { status: 400 }));
      }
    } else if (!ledgerEntryId) {
      // Default to Today IST
      const { getTodayRangeIST } = await import("@/utils/date.util");
      const { start, end } = getTodayRangeIST();
      query.createdAt = {
        $gte: start,
        $lte: end,
      };
    }

    if (search) {
      const searchOr = [
        { id: { $regex: search, $options: "i" } },
        { orderId: { $regex: search, $options: "i" } },
        { providerRef: { $regex: search, $options: "i" } },
        { utr: { $regex: search, $options: "i" } },
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else if (query.$and) {
        query.$and.push({ $or: searchOr });
      } else {
        query.$or = searchOr;
      }
    }

    const skip = (page - 1) * limit;

    // Handle Sorting
    let sortOptions: any = { createdAt: -1 };
    if (sort) {
      const field = sort.startsWith("-") ? sort.substring(1) : sort;
      const order = sort.startsWith("-") ? -1 : 1;
      sortOptions = { [field]: order };
    }

    // Dynamic Projection Optimization
    let currentProjection: any = {
      id: 1,
      type: 1,
      status: 1,
      amount: 1,
      currency: 1,
      orderId: 1,
      providerRef: 1,
      utr: 1,
      paymentMode: 1,
      party: 1,
      narration: 1,
      createdAt: 1,
      merchantId: 1,
      providerId: 1,
      legalEntityId: 1,
    };

    if (filter.fields) {
      currentProjection = {};
      filter.fields.split(",").forEach((f) => {
        currentProjection[f.trim()] = 1;
      });
      // Always include ID for internal consistency if not specified
      currentProjection.id = 1;
    }

    const [data, total] = await Promise.all([
      TransactionModel.find(query, currentProjection)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean<Partial<TransactionDocument>[]>(),
      TransactionModel.countDocuments(query),
    ]);



    const enrichedData = data.map((txn: any) => {
      const narration = [txn.type, txn.paymentMode, txn.utr]
        .filter(Boolean)
        .join("/");
      return mapTransactionAmountsToDisplay({
        ...txn,
        createdAt: getShiftedISTDate(txn.createdAt),
        narration,
      });
    });

    return ok({
      data: enrichedData,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  static async findByLedgerEntryId(
    ledgerEntryId: string,
    scope?: { merchantId?: string }
  ): Promise<{ id: string } | null> {
    if (!ledgerEntryId) return null;
    const query: any = this.buildLedgerEntryQuery(ledgerEntryId);
    if (scope?.merchantId) {
      query.merchantId = scope.merchantId;
    }
    return TransactionModel.findOne(query).select("id").lean<{ id: string }>();
  }

  static async getDetailsByLedgerEntryId(
    ledgerEntryId: string,
    scope?: { merchantId?: string }
  ): Promise<Result<TransactionDocument, HttpError>> {
    const txn = await this.findByLedgerEntryId(ledgerEntryId, scope);
    if (!txn) {
      return err(NotFound("Transaction not found for ledger entry"));
    }
    return this.getDetails(txn.id, scope);
  }

  /**
   * Get single transaction details
   */
  static async getDetails(
    identifier: string,
    scope?: {
      merchantId?: string;
    }
  ): Promise<Result<TransactionDocument, HttpError>> {
    // Search by transaction ID
    const query: any = {
      id: identifier,
    };

    if (scope?.merchantId) {
      query.$and = [
        {
          $or: [
            { merchantId: scope.merchantId },
          ],
        },
      ];
    }

    const txn = await TransactionModel.findOne(query).lean();
    if (!txn) {
      return err(NotFound("Transaction not found"));
    }

    const merchantIds = new Set<string>();
    const leIds = new Set<string>();
    const pleIds = new Set<string>();

    const [merchants, les, ples] = await Promise.all([
      merchantIds.size ? MerchantModel.find({ id: { $in: [...merchantIds] } }).select("id displayName name").lean() : [],
      leIds.size ? LegalEntityModel.find({ id: { $in: [...leIds] } }).select("id name").lean() : [],
      pleIds.size ? ProviderLegalEntityModel.find({ id: { $in: [...pleIds] } }).lean() : [],
    ]);

    const nameMap = new Map<string, string>();
    merchants.forEach((m: any) => nameMap.set(m.id, m.displayName || m.name));
    les.forEach((l: any) => nameMap.set(l.id, l.name));
    if (ples.length > 0) {
      const pIds = new Set(ples.map((p: any) => p.providerId));
      const lIds = new Set(ples.map((p: any) => p.legalEntityId));

      const [extraProviders, extraLes] = await Promise.all([
        pIds.size ? ProviderModel.find({ id: { $in: [...pIds] } }).select("id name").lean() : [],
        lIds.size ? LegalEntityModel.find({ id: { $in: [...lIds] } }).select("id name").lean() : []
      ]);

      const extraMap = new Map<string, string>();
      extraProviders.forEach((p: any) => extraMap.set(p.id, p.name));
      extraLes.forEach((l: any) => extraMap.set(l.id, l.name));

      ples.forEach((p: any) => {
        const pName = extraMap.get(p.providerId) || p.providerId;
        const leName = extraMap.get(p.legalEntityId) || p.legalEntityId;
        nameMap.set(p.id, `${pName} - ${leName}`);
      });
    }

    return ok(
      mapTransactionAmountsToDisplay({
        ...txn,
        createdAt: getShiftedISTDate(txn.createdAt),
        updatedAt: txn.updatedAt ? getShiftedISTDate(txn.updatedAt) : txn.updatedAt,
        // insertedDate is already stored as shifted IST (getISTDate) for backdated entries.
        // Do not shift again to avoid double-offset.
        insertedDate: (txn as any).insertedDate,
      } as any)
    );
  }

  /**
   * Reverse a transaction and its ledger entry
   */
  static async reverseTransaction(
    id: string,
    options: { ledgerEntryId?: string; reason?: string },
    actor: { id: string; email?: string; role?: string }
  ): Promise<Result<any, HttpError>> {
    const txn = await TransactionModel.findOne({ id });
    if (!txn) return err(NotFound("Transaction not found"));

    if (txn.status === TransactionStatus.REVERSED) {
      return err(Conflict("Transaction already reversed"));
    }

    const meta: any = txn.meta || {};
    const entryId =
      options.ledgerEntryId ||
      meta.ledgerEntryId ||
      meta.ledgerCommitEntryId ||
      meta.ledgerHoldEntryId;

    if (!entryId) {
      return err(
        BadRequest(
          "No ledger entry reference found. Provide ledgerEntryId to reverse."
        )
      );
    }

    let reverseEntryId: string;
    try {
      reverseEntryId = await LedgerService.reverse(
        entryId,
        actor.email || actor.id || "system"
      );
    } catch (error: any) {
      return err(
        new AppError("Failed to reverse ledger entry", {
          status: 500,
          details: { entryId, error: error?.message },
        })
      );
    }

    if (txn.meta?.set) {
      txn.meta.set("ledgerReverseEntryId", reverseEntryId);
    } else {
      (txn.meta as any).ledgerReverseEntryId = reverseEntryId;
    }

    txn.status = TransactionStatus.REVERSED;
    txn.events.push({
      type: "TRANSACTION_REVERSED",
      timestamp: getISTDate(),
      payload: {
        entryId,
        reverseEntryId,
        reason: options.reason,
        actor: {
          id: actor.id,
          email: actor.email,
          role: actor.role,
        },
      },
    });

    await txn.save();
    return ok({
      transactionId: txn.id,
      status: txn.status,
      ledgerEntryId: entryId,
      ledgerReverseEntryId: reverseEntryId,
    });
  }

  /**
   * Reverse ledger entries for any transaction type without changing transaction status.
   */
  static async reverseLedgerEntries(
    id: string,
    options: {
      ledgerEntryIds?: string[];
      includePrimary?: boolean;
      includeManual?: boolean;
      reason?: string;
      dryRun?: boolean;
    },
    actor: { id: string; email?: string; role?: string }
  ): Promise<Result<any, HttpError>> {
    const txn = await TransactionModel.findOne({ id });
    if (!txn) return err(NotFound("Transaction not found"));

    const metaGet = (key: string) => {
      if ((txn.meta as any)?.get) return (txn.meta as any).get(key);
      return (txn.meta as any)?.[key];
    };
    const metaSet = (key: string, value: any) => {
      if ((txn.meta as any)?.set) {
        (txn.meta as any).set(key, value);
        return;
      }
      (txn.meta as any)[key] = value;
    };

    const includePrimary = options.includePrimary !== false;
    const includeManual = options.includeManual !== false;

    const entryIds = new Set<string>();
    const skipped: Array<{ entryId: string; reason: string }> = [];

    if (options.ledgerEntryIds?.length) {
      options.ledgerEntryIds.forEach((id) => entryIds.add(id));
    } else {
      if (includePrimary) {
        const alreadyReversed = !!metaGet("ledgerReversed");
        const primary =
          metaGet("ledgerEntryId") ||
          metaGet("ledgerCommitEntryId") ||
          metaGet("ledgerHoldEntryId");
        if (primary) {
          if (alreadyReversed) {
            skipped.push({ entryId: primary, reason: "ledgerReversed=true" });
          } else {
            entryIds.add(primary);
          }
        }
      }

      if (includeManual) {
        const manual = (metaGet("manualLedgerEntries") || []) as Array<{
          id: string;
          action?: string;
        }>;
        for (const entry of manual) {
          const action = (entry?.action || "").toUpperCase();
          if (action.includes("REVERSE")) continue;
          entryIds.add(entry.id);
        }
      }
    }

    if (entryIds.size === 0 && skipped.length > 0 && !options.ledgerEntryIds?.length) {
      return ok({
        transactionId: txn.id,
        status: txn.status,
        reversed: [],
        failed: [],
        skipped,
        note: "No eligible ledger entries to reverse",
      });
    }

    if (entryIds.size === 0) {
      return err(
        BadRequest(
          "No ledger entries found to reverse. Provide ledgerEntryIds or ensure transaction has ledger entries."
        )
      );
    }

    const candidates = [...entryIds];
    if (options.dryRun) {
      return ok({
        transactionId: txn.id,
        dryRun: true,
        ledgerEntryIds: candidates,
      });
    }

    const reversed: Array<{ entryId: string; reverseEntryId: string }> = [];
    const failed: Array<{ entryId: string; error: string }> = [];

    for (const entryId of candidates) {
      try {
        const reverseEntryId = await LedgerService.reverse(
          entryId,
          actor.email || actor.id || "system"
        );
        reversed.push({ entryId, reverseEntryId });
      } catch (error: any) {
        failed.push({ entryId, error: error?.message || "Reverse failed" });
      }
    }

    const existingReversals = metaGet("ledgerReverseEntryIds") || [];
    const updatedReversals = [
      ...existingReversals,
      ...reversed.map((r) => ({
        entryId: r.entryId,
        reverseEntryId: r.reverseEntryId,
        timestamp: getISTDate(),
        reason: options.reason,
      })),
    ];
    metaSet("ledgerReverseEntryIds", updatedReversals);

    txn.events.push({
      type: "LEDGER_ENTRIES_REVERSED",
      timestamp: getISTDate(),
      payload: {
        ledgerEntryIds: candidates,
        reversed,
        failed,
        skipped,
        reason: options.reason,
        actor: {
          id: actor.id,
          email: actor.email,
          role: actor.role,
        },
      },
    });

    await txn.save();

    return ok({
      transactionId: txn.id,
      status: txn.status,
      reversed,
      failed,
      skipped,
    });
  }

  /**
   * Admin: Sync status from provider for a transaction (no status change if still pending).
   */
  static async syncStatus(
    id: string,
    actor: { id: string; email?: string; role?: string },
    options?: { confirm?: boolean }
  ): Promise<Result<any, HttpError>> {
    try {
      const updated = await paymentService.manualStatusSync(
        { transactionId: id, confirm: !!options?.confirm },
        actor.email || actor.id || "system"
      );
      return ok(updated);
    } catch (error: any) {
      return err(
        new AppError(error?.message || "Status sync failed", {
          status: 500,
          details: { transactionId: id },
        })
      );
    }
  }

  /**
   * Admin: Resend merchant callback webhook for a transaction.
   */
  static async resendWebhook(
    id: string,
    reason: string | undefined,
    actor: { id: string; email?: string; role?: string }
  ): Promise<Result<any, HttpError>> {
    const txn = await TransactionModel.findOne({ id });
    if (!txn) return err(NotFound("Transaction not found"));

    MerchantCallbackService.notify(txn, { source: "ADMIN_RESEND" });

    txn.events.push({
      type: "ADMIN_RESEND_WEBHOOK",
      timestamp: getISTDate(),
      payload: {
        reason,
        actor: {
          id: actor.id,
          email: actor.email,
          role: actor.role,
        },
      },
    });
    await txn.save();

    return ok({ transactionId: txn.id, status: txn.status, resent: true });
  }
}
