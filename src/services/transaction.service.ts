import {
  TransactionModel,
  TransactionDocument,
} from "@/models/transaction.model";
import { ListQueryDTO } from "@/dto/common.dto";
import { Result, ok, err } from "@/utils/result";
import { HttpError, NotFound, AppError } from "@/utils/error";
import { MerchantModel } from "@/models/merchant.model";
import { ProviderModel } from "@/models/provider.model";
import { LegalEntityModel } from "@/models/legal-entity.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { getShiftedISTDate } from "@/utils/date.util";

export interface TransactionListFilter extends ListQueryDTO {
  merchantId?: string; // Kept for alias
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
  fields?: string; // Comma-separated fields for projection
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
      sort,
      category,
    } = filter;

    const query: any = {};

    if (providerId) query.providerId = providerId;
    if (merchantId) query.merchantId = merchantId;
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
      return {
        ...txn,
        createdAt: getShiftedISTDate(txn.createdAt),
        narration,
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

    return ok({
      ...txn,
      createdAt: getShiftedISTDate(txn.createdAt),
    } as any);
  }
}
