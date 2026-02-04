import {
  TransactionModel,
  TransactionDocument,
} from "@/models/transaction.model";
import { TransactionEntityType } from "@/constants/transaction.constant";
import { ListQueryDTO } from "@/dto/common.dto";
import { Result, ok, err } from "@/utils/result";
import { HttpError, NotFound, AppError } from "@/utils/error";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderModel } from "@/models/provider.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";

export interface TransactionListFilter extends ListQueryDTO {
  merchantId?: string; // Kept for alias
  entityId?: string;
  entityType?: string;
  providerId?: string;
  legalEntityId?: string;
  type?: string;
  status?: string;
  orderId?: string;
  providerRef?: string;
  utr?: string;
  startDate?: string;
  endDate?: string;
  category?: "PAYIN" | "PAYOUT" | "OTHER";
}

export class TransactionService {
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
      entityId,
      entityType,
      sort,
      category,
    } = filter;

    const query: any = {};

    // Double Entry Logic: Filter by entity checks both source and destination
    if (merchantId) {
      // Legacy alias check
      query.$or = [
        { sourceEntityId: merchantId, sourceEntityType: TransactionEntityType.MERCHANT },
        { destinationEntityId: merchantId, destinationEntityType: TransactionEntityType.MERCHANT }
      ];
    }

    if (entityId) {
      const entityCheck = [
        { sourceEntityId: entityId },
        { destinationEntityId: entityId }
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: entityCheck }];
        delete query.$or;
      } else {
        query.$or = entityCheck;
      }
    }

    if (entityType) {
      if (entityId) {
        query.$or = [
          { sourceEntityId: entityId, sourceEntityType: entityType },
          { destinationEntityId: entityId, destinationEntityType: entityType }
        ];
        // Simplify constraint: if specifically asking for entity+type, override previous loose check
        if (query.$and) delete query.$and;
      } else {
        query.$or = [
          { sourceEntityType: entityType },
          { destinationEntityType: entityType }
        ];
      }
    }

    if (providerId) query.providerId = providerId;
    if (legalEntityId) query.legalEntityId = legalEntityId;
    if (providerId) query.providerId = providerId;
    if (legalEntityId) query.legalEntityId = legalEntityId;
    if (utr) query.utr = utr;

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
    } else {
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
      // Allow sorting by safe fields only if needed, but for now allow all top-level
      sortOptions = { [field]: order };
    }

    // Minimal Projection Fields
    const projection = {
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
      sourceEntityId: 1,
      sourceEntityType: 1,
      destinationEntityId: 1,
      destinationEntityType: 1,
      providerId: 1,
      legalEntityId: 1,
      _id: 0,
    };

    const [data, total] = await Promise.all([
      TransactionModel.find(query, projection)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean<Partial<TransactionDocument>[]>(),
      TransactionModel.countDocuments(query),
    ]);

    // --- Entity Resolution ---
    const merchantIds = new Set<string>();
    const providerIds = new Set<string>();
    const leIds = new Set<string>();
    const pleIds = new Set<string>();

    const collectId = (id: string | undefined, type: string | undefined) => {
      if (!id || !type) return;
      if (type === "MERCHANT") merchantIds.add(id);
      if (type === "PROVIDER") providerIds.add(id);
      if (type === "LEGAL_ENTITY") leIds.add(id);
      if (type === "PROVIDER_LEGAL_ENTITY") pleIds.add(id);
    };

    data.forEach((t: any) => {
      collectId(t.sourceEntityId, t.sourceEntityType);
      collectId(t.destinationEntityId, t.destinationEntityType);
    });

    // Pre-fetch PLEs to ensure we have their constituent Provider/LE IDs
    const ples = pleIds.size
      ? await ProviderLegalEntityModel.find({ id: { $in: [...pleIds] } })
        .select("id name providerId legalEntityId")
        .lean()
      : [];

    ples.forEach((p: any) => {
      if (p.providerId) providerIds.add(p.providerId);
      if (p.legalEntityId) leIds.add(p.legalEntityId);
    });

    const [merchants, providers, les] = await Promise.all([
      merchantIds.size
        ? MerchantModel.find({ id: { $in: [...merchantIds] } })
          .select("id displayName name")
          .lean()
        : [],
      providerIds.size
        ? ProviderModel.find({ id: { $in: [...providerIds] } })
          .select("id name")
          .lean()
        : [],
      leIds.size
        ? LegalEntityModel.find({ id: { $in: [...leIds] } })
          .select("id name")
          .lean()
        : [],
    ]);

    const nameMap = new Map<string, string>();
    merchants.forEach((m: any) => nameMap.set(m.id, m.displayName || m.name));
    providers.forEach((p: any) => nameMap.set(p.id, p.name));
    les.forEach((l: any) => nameMap.set(l.id, l.name));

    ples.forEach((ple: any) => {
      if (ple.name) {
        nameMap.set(ple.id, ple.name);
      } else {
        const pName = nameMap.get(ple.providerId) || ple.providerId;
        const lName = nameMap.get(ple.legalEntityId) || ple.legalEntityId;
        nameMap.set(ple.id, `${pName} - ${lName}`);
      }
    });

    const enrichedData = data.map((txn: any) => {
      const ref = txn.providerRef || txn.orderId || txn.id || "";

      const sourceName = nameMap.get(txn.sourceEntityId) || txn.sourceEntityType || "UNKNOWN";
      const destName = nameMap.get(txn.destinationEntityId) || txn.destinationEntityType || "UNKNOWN";

      const narration = [txn.type, txn.paymentMode, txn.utr]
        .filter(Boolean)
        .join("/");

      return {
        ...txn,
        sourceEntityName: sourceName,
        destinationEntityName: destName,
        narration,
        utr: txn.utr || null, // Ensure UTR is present
      };
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

  /**
   * Get single transaction details
   */
  static async getDetails(
    identifier: string,
    scope?: {
      merchantId?: string;
      providerId?: string;
    }
  ): Promise<Result<TransactionDocument, HttpError>> {
    // Search by transaction ID
    const query: any = {
      id: identifier,
    };

    if (scope?.merchantId) {
      // Allow access if merchantId matches OR if source/dest entity is this merchant
      query.$and = [
        {
          $or: [
            { merchantId: scope.merchantId },
            { sourceEntityId: scope.merchantId },
            { destinationEntityId: scope.merchantId },
          ],
        },
      ];
    }
    // Future: if (scope?.providerId) query.providerId = scope.providerId;

    const txn = await TransactionModel.findOne(query).lean();
    if (!txn) {
      return err(NotFound("Transaction not found"));
    }

    // --- Entity Resolution for Single Transaction ---
    const merchantIds = new Set<string>();
    const providerIds = new Set<string>();
    const leIds = new Set<string>();
    const pleIds = new Set<string>();

    const collectId = (id: string | undefined, type: string | undefined) => {
      if (!id || !type) return;
      if (type === "MERCHANT") merchantIds.add(id);
      if (type === "PROVIDER") providerIds.add(id);
      if (type === "LEGAL_ENTITY") leIds.add(id);
      if (type === "PROVIDER_LEGAL_ENTITY") pleIds.add(id);
    };

    collectId(txn.sourceEntityId, txn.sourceEntityType);
    collectId(txn.destinationEntityId, txn.destinationEntityType);

    const [merchants, providers, les, ples] = await Promise.all([
      merchantIds.size ? MerchantModel.find({ id: { $in: [...merchantIds] } }).select("id displayName name").lean() : [],
      providerIds.size ? ProviderModel.find({ id: { $in: [...providerIds] } }).select("id name").lean() : [],
      leIds.size ? LegalEntityModel.find({ id: { $in: [...leIds] } }).select("id name").lean() : [],
      pleIds.size ? ProviderLegalEntityModel.find({ id: { $in: [...pleIds] } }).lean() : [],
    ]);

    const nameMap = new Map<string, string>();
    merchants.forEach((m: any) => nameMap.set(m.id, m.displayName || m.name));
    providers.forEach((p: any) => nameMap.set(p.id, p.name));
    les.forEach((l: any) => nameMap.set(l.id, l.name));

    // Manually resolve PLE component names to avoid CastError on populate
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

    const sourceName = nameMap.get(txn.sourceEntityId) || txn.sourceEntityType || "UNKNOWN";
    const destName = nameMap.get(txn.destinationEntityId) || txn.destinationEntityType || "UNKNOWN";

    (txn as any).sourceEntityName = sourceName;
    (txn as any).destinationEntityName = destName;

    // Enrich with Ledger Transfers (Always fetch live from TigerBeetle for accuracy as requested)
    let transfers: any[] = [];

    // Extract all potential IDs from meta
    const idsToLookup: bigint[] = [];
    const meta = txn.meta || {};

    if (meta.transferId) idsToLookup.push(BigInt(meta.transferId));
    if (meta.feeTransferId) idsToLookup.push(BigInt(meta.feeTransferId));
    if (Array.isArray(meta.transferIds)) {
      meta.transferIds.forEach((id: string) => idsToLookup.push(BigInt(id)));
    }

    if (idsToLookup.length > 0) {
      try {
        const { LedgerService } = await import(
          "@/services/ledger/ledger.service"
        );
        const { AccountManagerService } = await import(
          "@/services/ledger/account-manager.service"
        );

        // Use a set to avoid duplicate lookups
        const uniqueIds = [...new Set(idsToLookup)];
        const tbTransfers = await LedgerService.lookupTransfers(uniqueIds);

        // Resolve owner details for all involved accounts
        const allAccIds = tbTransfers.flatMap((t) => [
          t.debit_account_id.toString(),
          t.credit_account_id.toString(),
        ]);
        const accountMap = await AccountManagerService.resolveAccountDetails([
          ...new Set(allAccIds),
        ]);

        // Map TB transfers to plain objects for the response
        tbTransfers.forEach((t) => {
          const tId = t.id.toString();
          const dId = t.debit_account_id.toString();
          const cId = t.credit_account_id.toString();
          const dDet = accountMap.get(dId);
          const cDet = accountMap.get(cId);

          transfers.push({
            id: tId,
            debitAccountId: dId,
            debitOwnerType: dDet?.ownerType,
            debitOwnerName: dDet?.ownerName,
            creditAccountId: cId,
            creditOwnerType: cDet?.ownerType,
            creditOwnerName: cDet?.ownerName,
            amount: t.amount.toString(),
            code: t.code,
            flags: t.flags,
            timestamp: t.timestamp.toString(),
            isFee: tId === meta.feeTransferId,
          });
        });
      } catch (e) {
        console.error("Failed to enrich transaction with live TigerBeetle transfers:", e);
        // Fallback to snapshot if TB lookup fails
        transfers = txn.meta?.ledgerTransfers || [];
      }
    } else {
      // No IDs to lookup, use snapshot if available
      transfers = txn.meta?.ledgerTransfers || [];
    }

    return ok({
      ...txn,
      ledgerTransfers: transfers,
    } as any);
  }
}
