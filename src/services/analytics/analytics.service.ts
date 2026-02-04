import {
  TransactionModel,
  TransactionStatus,
} from "@/models/transaction.model";
import { TransactionType } from "@/constants/transaction.constant";
import { getISTDate } from "@/utils/date.util";
import { LedgerAccountModel } from "@/models/ledger-account.model";
import { ACCOUNT_TYPE } from "@/constants/tigerbeetle.constant";
import { paisaToRupee } from "@/utils/currency.util";

export interface AnalyticsStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  processing: number;
  successRate: number;
  totalAmount: number;
  successAmount: number;
  balance?: number; // Ledger Balance (Real-time)
}

export interface DashboardAnalytics {
  payin: AnalyticsStats;
  payout: AnalyticsStats;
  revenueChart: { date: string; revenue: number; expenses: number }[];
  recentTransactions?: any[]; // Using any[] for now to avoid circular deps or complex type mapping
}

export interface AnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  merchantId?: string | string[];
  providerId?: string | string[];
  legalEntityId?: string | string[];
  bucket?: "hourly" | "daily";
}




export class AnalyticsService {
  /**
   * Get comprehensive dashboard stats using a single aggregation pipeline.
   * Supports Time-Series densification and precise P/L separation.
   */
  static async getDetailedDashboardStats(
    filters: AnalyticsFilters & {
      timeFrame?: "hourly" | "daily"; // last 24h or last 7d/30d
      merchantIds?: string[];
      providerIds?: string[];
      legalEntityIds?: string[];
    }
  ) {
    const timeUnit = filters.timeFrame === "hourly" ? "hour" : "day";
    const now = getISTDate();
    let startDate = filters.startDate;

    // Default time ranges if not provided
    if (!startDate) {
      startDate = new Date(now);
      if (timeUnit === "hour") {
        startDate.setHours(startDate.getHours() - 24); // Last 24h
      } else {
        startDate.setDate(startDate.getDate() - 7); // Last 7 days
      }
    }
    const endDate = filters.endDate || now;

    const matchStage: any = {
      type: { $in: ["PAYIN", "PAYOUT"] }, // Hard business rule
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (filters.merchantIds?.length) matchStage.merchantId = { $in: filters.merchantIds };
    if (filters.providerIds?.length) matchStage.providerId = { $in: filters.providerIds };
    if (filters.legalEntityIds?.length) matchStage.legalEntityId = { $in: filters.legalEntityIds };

    // Fallback simple filters override array filters if both present (should handle in caller)
    if (filters.merchantId) matchStage.merchantId = filters.merchantId;
    if (filters.providerId) matchStage.providerId = filters.providerId;
    if (filters.legalEntityId) matchStage.legalEntityId = filters.legalEntityId;

    const pipeline: any[] = [
      { $match: matchStage },
      {
        $facet: {
          payinOverview: [
            { $match: { type: "PAYIN" } },
            {
              $group: {
                _id: null,
                totalVolume: { $sum: "$amount" },
                totalCount: { $sum: 1 },
                successVolume: {
                  $sum: { $cond: [{ $eq: ["$status", "SUCCESS"] }, "$amount", 0] },
                },
                successCount: {
                  $sum: { $cond: [{ $eq: ["$status", "SUCCESS"] }, 1, 0] },
                },
                failedVolume: {
                  $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, "$amount", 0] },
                },
                failedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
                },
                pendingVolume: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["PENDING", "PROCESSING"]] },
                      "$amount",
                      0,
                    ],
                  },
                },
                pendingCount: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["PENDING", "PROCESSING"]] },
                      1,
                      0,
                    ],
                  },
                },
                avgTransactionAmountRaw: { $avg: "$amount" },
                highTransactionAmountRaw: { $max: "$amount" },
                successFees: {
                  $sum: { $cond: [{ $eq: ["$status", "SUCCESS"] }, { $ifNull: ["$fees.merchantFees.total", 0] }, 0] }
                },
              },
            },
            {
              $addFields: {
                totalVolume: { $round: ["$totalVolume", 2] },
                successVolume: { $round: ["$successVolume", 2] },
                failedVolume: { $round: ["$failedVolume", 2] },
                pendingVolume: { $round: ["$pendingVolume", 2] },
                successFees: { $round: ["$successFees", 2] },
                avgTransactionAmount: { $round: ["$avgTransactionAmountRaw", 2] },
                highTransactionAmount: { $round: ["$highTransactionAmountRaw", 2] },
                successRate: {
                  $round: [
                    {
                      $cond: [
                        { $eq: ["$totalCount", 0] },
                        0,
                        {
                          $multiply: [
                            { $divide: ["$successCount", "$totalCount"] },
                            100,
                          ],
                        },
                      ],
                    },
                    2
                  ]
                },
                failureRate: {
                  $round: [
                    {
                      $cond: [
                        { $eq: ["$totalCount", 0] },
                        0,
                        {
                          $multiply: [
                            { $divide: ["$failedCount", "$totalCount"] },
                            100,
                          ],
                        },
                      ],
                    },
                    2
                  ]
                },
                pendingRate: {
                  $round: [
                    {
                      $cond: [
                        { $eq: ["$totalCount", 0] },
                        0,
                        {
                          $multiply: [
                            { $divide: ["$pendingCount", "$totalCount"] },
                            100,
                          ],
                        },
                      ],
                    },
                    2
                  ]
                },
              },
            },
            {
              $project: {
                avgTransactionAmountRaw: 0,
                highTransactionAmountRaw: 0
              }
            }
          ],
          payoutOverview: [
            { $match: { type: "PAYOUT" } },
            {
              $group: {
                _id: null,
                totalVolume: { $sum: "$amount" },
                totalCount: { $sum: 1 },
                successVolume: {
                  $sum: { $cond: [{ $eq: ["$status", "SUCCESS"] }, "$amount", 0] },
                },
                successCount: {
                  $sum: { $cond: [{ $eq: ["$status", "SUCCESS"] }, 1, 0] },
                },
                failedVolume: {
                  $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, "$amount", 0] },
                },
                failedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] },
                },
                pendingVolume: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["PENDING", "PROCESSING"]] },
                      "$amount",
                      0,
                    ],
                  },
                },
                pendingCount: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["PENDING", "PROCESSING"]] },
                      1,
                      0,
                    ],
                  },
                },
                avgTransactionAmountRaw: { $avg: "$amount" },
                highTransactionAmountRaw: { $max: "$amount" },
                successFees: {
                  $sum: { $cond: [{ $eq: ["$status", "SUCCESS"] }, { $ifNull: ["$fees.merchantFees.total", 0] }, 0] }
                },
              },
            },
            {
              $addFields: {
                totalVolume: { $round: ["$totalVolume", 2] },
                successVolume: { $round: ["$successVolume", 2] },
                failedVolume: { $round: ["$failedVolume", 2] },
                pendingVolume: { $round: ["$pendingVolume", 2] },
                successFees: { $round: ["$successFees", 2] },
                avgTransactionAmount: { $round: ["$avgTransactionAmountRaw", 2] },
                highTransactionAmount: { $round: ["$highTransactionAmountRaw", 2] },
                successRate: {
                  $round: [
                    {
                      $cond: [
                        { $eq: ["$totalCount", 0] },
                        0,
                        {
                          $multiply: [
                            { $divide: ["$successCount", "$totalCount"] },
                            100,
                          ],
                        },
                      ],
                    },
                    2
                  ]
                },
                failureRate: {
                  $round: [
                    {
                      $cond: [
                        { $eq: ["$totalCount", 0] },
                        0,
                        {
                          $multiply: [
                            { $divide: ["$failedCount", "$totalCount"] },
                            100,
                          ],
                        },
                      ],
                    },
                    2
                  ]
                },
                pendingRate: {
                  $round: [
                    {
                      $cond: [
                        { $eq: ["$totalCount", 0] },
                        0,
                        {
                          $multiply: [
                            { $divide: ["$pendingCount", "$totalCount"] },
                            100,
                          ],
                        },
                      ],
                    },
                    2
                  ]
                },
              },
            },
            {
              $project: {
                avgTransactionAmountRaw: 0,
                highTransactionAmountRaw: 0
              }
            }
          ],
          timeSeries: [
            {
              $project: {
                type: 1,
                amount: 1,
                timestamp: {
                  $dateTrunc: {
                    date: "$createdAt",
                    unit: timeUnit,
                  },
                },
              },
            },
            {
              $group: {
                _id: {
                  type: "$type",
                  timestamp: "$timestamp",
                },
                volume: { $sum: "$amount" },
              },
            },
            {
              $densify: {
                field: "_id.timestamp",
                partitionByFields: ["_id.type"],
                range: {
                  step: 1,
                  unit: timeUnit,
                  bounds: "full",
                },
              },
            },
            {
              $group: {
                _id: "$_id.timestamp",
                payin: {
                  $sum: {
                    $cond: [{ $eq: ["$_id.type", "PAYIN"] }, { $ifNull: ["$volume", 0] }, 0]
                  }
                },
                payout: {
                  $sum: {
                    $cond: [{ $eq: ["$_id.type", "PAYOUT"] }, { $ifNull: ["$volume", 0] }, 0]
                  }
                }
              }
            },
            {
              $addFields: {
                payin: { $round: ["$payin", 2] },
                payout: { $round: ["$payout", 2] },
              }
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                date: {
                  $dateToString: {
                    format: timeUnit === "hour" ? "%H:00" : "%d %b",
                    date: "$_id",
                    timezone: "Asia/Kolkata"
                  }
                },
                payin: 1,
                payout: 1,
                fullDate: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$_id",
                    timezone: "Asia/Kolkata"
                  }
                }
              },
            }
          ],
        },
      },
    ];

    const result = await TransactionModel.aggregate(pipeline);
    const data = result[0] || {};

    // Fetch Real-time Ledger Balances
    const ledgerBalances = await this.getAggregateBalances(filters.merchantIds);

    // Default stats structure
    const defaultStats = {
      totalVolume: 0,
      totalCount: 0,
      successVolume: 0,
      successCount: 0,
      failedVolume: 0,
      failedCount: 0,
      pendingVolume: 0,
      pendingCount: 0,
      avgTransactionAmount: 0,
      highTransactionAmount: 0,
      successRate: 0,
      failureRate: 0
    };

    const payinStats = data.payinOverview?.[0] || defaultStats;
    const payoutStats = data.payoutOverview?.[0] || defaultStats;

    payinStats.balance = ledgerBalances.payin;
    payoutStats.balance = ledgerBalances.payout;

    return {
      payin: payinStats,
      payout: payoutStats,
      timeSeries: data.timeSeries || []
    };
  }

  /**
   * Helper to aggregate Ledger Balances for Merchants (Payin & Payout)
   * Fetches real-time balances from TigerBeetle.
   */
  private static async getAggregateBalances(merchantIds?: string[]): Promise<{ payin: number; payout: number }> {
    const filter: any = {
      typeSlug: { $in: [ACCOUNT_TYPE.MERCHANT_PAYIN.slug, ACCOUNT_TYPE.MERCHANT_PAYOUT.slug] },
      ownerType: "MERCHANT", // Only fetch Merchant accounts
    };

    if (merchantIds && merchantIds.length > 0) {
      filter.ownerId = { $in: merchantIds };
    }

    // 1. Get Accounts from Mongo
    const accounts = await LedgerAccountModel.find(filter).select("accountId typeSlug").lean();
    if (!accounts.length) return { payin: 0, payout: 0 };

    // 2. Fetch Balances from TigerBeetle
    const { LedgerService } = await import("@/services/ledger/ledger.service");
    const accountIds = accounts.map((a) => BigInt(a.accountId));

    let balances: any[] = [];
    try {
      balances = await LedgerService.getBalances(accountIds);
    } catch (e) {
      console.error("Failed to fetch aggregate balances from TB", e);
      return { payin: 0, payout: 0 };
    }

    let payinTotal = 0n;
    let payoutTotal = 0n;

    // 3. Sum up Balances
    balances.forEach((b) => {
      const acc = accounts.find((a) => BigInt(a.accountId) === b.id);
      if (!acc) return;

      // LIABILITY Account Logic: Credits - Debits
      // Merchant accounts are Liabilities (Funds belonging to Merchant held by System)
      const credits = BigInt(b.credits_posted || 0);
      const debits = BigInt(b.debits_posted || 0);

      const balance = credits - debits;

      if (acc.typeSlug === ACCOUNT_TYPE.MERCHANT_PAYIN.slug) {
        payinTotal += balance;
      } else if (acc.typeSlug === ACCOUNT_TYPE.MERCHANT_PAYOUT.slug) {
        payoutTotal += balance;
      }
    });

    return {
      payin: Math.round(Number(paisaToRupee(payinTotal)) * 100) / 100,
      payout: Math.round(Number(paisaToRupee(payoutTotal)) * 100) / 100
    };
  }
}
