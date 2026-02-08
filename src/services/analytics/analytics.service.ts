import {
  TransactionModel,
} from "@/models/transaction.model";
import { getISTDate } from "@/utils/date.util";
import { LedgerService } from "@/services/ledger/ledger.service";
import { LedgerUtils } from "@/utils/ledger.utils";
import { ENTITY_TYPE, ENTITY_ACCOUNT_TYPE } from "@/constants/ledger.constant";
import { AccountType } from "fintech-ledger";
import { toDisplayAmount } from "@/utils/money.util";


export interface AnalyticsStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  processing: number;
  successRate: number;
  totalAmount: number;
  successAmount: number;
  balance?: string; // Changed to string for precise currency formatting (e.g. "123.45")
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
      startDate?: Date;
      endDate?: Date;
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

    // Handle Merchant Filters (Array takes precedence)
    if (filters.merchantIds?.length) {
      matchStage.merchantId = { $in: filters.merchantIds };
    } else if (filters.merchantId) {
      matchStage.merchantId = filters.merchantId;
    }

    // Handle Provider Filters
    if (filters.providerIds?.length) {
      matchStage.providerId = { $in: filters.providerIds };
    } else if (filters.providerId) {
      matchStage.providerId = filters.providerId;
    }

    // Handle Legal Entity Filters
    if (filters.legalEntityIds?.length) {
      matchStage.legalEntityId = { $in: filters.legalEntityIds };
    } else if (filters.legalEntityId) {
      matchStage.legalEntityId = filters.legalEntityId;
    }

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
                    format: timeUnit === "hour" ? "%H:00" : "%Y-%m-%d",
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

    const payinStats = data.payinOverview?.[0] ? { ...data.payinOverview[0] } : { ...defaultStats };
    const payoutStats = data.payoutOverview?.[0] ? { ...data.payoutOverview[0] } : { ...defaultStats };

    const normalizeStats = (stats: any) => ({
      ...stats,
      totalVolume: toDisplayAmount(stats.totalVolume || 0),
      successVolume: toDisplayAmount(stats.successVolume || 0),
      failedVolume: toDisplayAmount(stats.failedVolume || 0),
      pendingVolume: toDisplayAmount(stats.pendingVolume || 0),
      avgTransactionAmount: toDisplayAmount(stats.avgTransactionAmount || 0),
      highTransactionAmount: toDisplayAmount(stats.highTransactionAmount || 0),
      successFees: toDisplayAmount(stats.successFees || 0),
    });

    const normalizedPayinStats = normalizeStats(payinStats);
    const normalizedPayoutStats = normalizeStats(payoutStats);

    // --- Real-time Balance Integration ---
    let merchantIds = filters.merchantIds || (filters.merchantId ? (Array.isArray(filters.merchantId) ? filters.merchantId : [filters.merchantId]) : []);

    // If no merchants specified, fetch all merchants
    if (merchantIds.length === 0) {
      try {
        const { MerchantModel } = await import('@/models/merchant.model');
        const allMerchants = await MerchantModel.find({}).select('id').lean();
        merchantIds = allMerchants.map(m => m.id);
      } catch (error) {
        console.error('Failed to fetch all merchants for balance calculation:', error);
        merchantIds = [];
      }
    }

    if (merchantIds.length > 0) {
      let totalPayinBalance = 0;
      let totalPayoutBalance = 0;

      for (const mid of merchantIds) {
        const payinId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, mid, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.PAYIN);
        const payoutId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, mid, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.PAYOUT);

        const [payinBal, payoutBal] = await Promise.all([
          LedgerService.getBalance(payinId).catch(() => "0.00"),
          LedgerService.getBalance(payoutId).catch(() => "0.00")
        ]);

        // Payin Balance (Money In)
        totalPayinBalance += parseFloat(payinBal);

        // Payout Balance (Money available for Payout)
        totalPayoutBalance += parseFloat(payoutBal);
      }

      // Convert to Absolute for Liability Accounts
      // LedgerService.getBalance returns normalized balance (positive for LIABILITY)
      normalizedPayinStats.balance = Math.abs(totalPayinBalance).toFixed(2);
      normalizedPayoutStats.balance = Math.abs(totalPayoutBalance).toFixed(2);
    } else {
      normalizedPayinStats.balance = "0.00";
      normalizedPayoutStats.balance = "0.00";
    }

    return {
      payin: normalizedPayinStats,
      payout: normalizedPayoutStats,
      timeSeries: (data.timeSeries || []).map((row: any) => ({
        ...row,
        payin: toDisplayAmount(row.payin || 0),
        payout: toDisplayAmount(row.payout || 0),
      }))
    };
  }

}
