import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { JobQueue } from "@/utils/job-queue.util";
import { logger } from "@/infra/logger-instance";
import { TransactionType } from "@/constants/transaction.constant";
import { LedgerOperationService } from "@/services/ledger/ledger-operation.service";
import { LedgerTransferService } from "@/services/ledger/ledger-transfer.service";
import { LEDGER_OPERATION } from "@/constants/ledger-operations.constant";
import { getISTDayStart, getISTDayEnd } from "@/utils/date.util";

export class ProviderFeeSettlementService {
    /**
     * Enqueue settlement jobs for ALL Provider Legal Entities for "yesterday"
     */
    static async enqueueEodSettlement() {
        const now = new Date();
        // Yesterday in IST
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];

        logger.info({ date: dateStr }, "[ProviderFeeSettlementService] Starting EOD enqueue");

        // Process ALL PLEs regardless of status as per requirement
        const allPles = await ProviderLegalEntityModel.find({}).select('id');

        for (const ple of allPles) {
            await JobQueue.enqueue({
                type: "PROVIDER_FEE_SETTLEMENT",
                payload: {
                    pleId: ple.id,
                    targetDate: dateStr
                }
            });
        }

        logger.info({ count: allPles.length }, "[ProviderFeeSettlementService] Enqueued settlement jobs");
    }

    /**
     * Process settlement for a specific PLE and date
     */
    static async processPLESettlement(pleId: string, dateStr: string) {
        logger.info({ pleId, date: dateStr }, "[ProviderFeeSettlementService] Processing settlement");

        const ple = await ProviderLegalEntityModel.findOne({ id: pleId });
        if (!ple) {
            logger.error({ pleId }, "[ProviderFeeSettlementService] PLE not found");
            return;
        }

        // 1. Idempotency Check
        const existing = await TransactionModel.findOne({
            type: TransactionType.PLE_EXPENSE_CHARGE,
            providerLegalEntityId: pleId,
            "meta.settlementDate": dateStr
        });
        const existingPayinSettlement = await TransactionModel.findOne({
            type: TransactionType.PLE_PAYIN_FEE_CHARGE,
            providerLegalEntityId: pleId,
            "meta.settlementDate": dateStr
        });

        const existingPayoutSettlement = await TransactionModel.findOne({
            type: TransactionType.PLE_PAYOUT_FEE_CHARGE,
            providerLegalEntityId: pleId,
            "meta.settlementDate": dateStr
        });

        if (existingPayinSettlement && existingPayoutSettlement) {
            logger.warn({ pleId, date: dateStr, payinTxnId: existingPayinSettlement.id, payoutTxnId: existingPayoutSettlement.id }, "[ProviderFeeSettlementService] Settlement already processed (both payin and payout)");
            return;
        }

        // 2. Aggregate Fees separately for PAYIN and PAYOUT
        const start = getISTDayStart(dateStr);
        const end = getISTDayEnd(dateStr);

        const aggregation = await TransactionModel.aggregate([
            {
                $match: {
                    providerLegalEntityId: pleId,
                    status: TransactionStatus.SUCCESS,
                    type: { $in: [TransactionType.PAYIN, TransactionType.PAYOUT] },
                    updatedAt: { $gte: start, $lte: end }
                }
            },
            {
                $group: {
                    _id: "$type",
                    totalFees: { $sum: { $ifNull: ["$fees.providerFees.total", 0] } },
                    count: { $sum: 1 }
                }
            }
        ]);

        const payinData = aggregation.find(r => r._id === TransactionType.PAYIN) || { totalFees: 0, count: 0 };
        const payoutData = aggregation.find(r => r._id === TransactionType.PAYOUT) || { totalFees: 0, count: 0 };

        logger.info({
            pleId,
            date: dateStr,
            payinFees: payinData.totalFees,
            payoutFees: payoutData.totalFees
        }, "[ProviderFeeSettlementService] Aggregated fees calculated");

        // 3. Create Settlement Transactions
        try {
            // A. Payin Fee Charge (From Payin Account)
            if (payinData.totalFees >= 0) { // Settle even if 0 as per requirement
                await LedgerOperationService.createOperation({
                    operation: LEDGER_OPERATION.PLE_PAYIN_FEE_CHARGE as any,
                    status: "POSTED",
                    providerLegalEntityId: pleId,
                    amount: payinData.totalFees,
                    currency: "INR",
                    narration: `Daily Payin Fees Settlement for ${dateStr}`,
                    orderId: `FEE_PAYIN_${pleId}_${dateStr}`,
                    metadata: { settlementDate: dateStr, originalTxnCount: payinData.count }
                }, { id: "SYSTEM", role: "CRON" });
            }

            // B. Payout Fee Charge (From Payout Account)
            if (payoutData.totalFees >= 0) {
                await LedgerOperationService.createOperation({
                    operation: LEDGER_OPERATION.PLE_PAYOUT_FEE_CHARGE as any,
                    status: "POSTED",
                    providerLegalEntityId: pleId,
                    amount: payoutData.totalFees,
                    currency: "INR",
                    narration: `Daily Payout Fees Settlement for ${dateStr}`,
                    orderId: `FEE_PAYOUT_${pleId}_${dateStr}`,
                    metadata: { settlementDate: dateStr, originalTxnCount: payoutData.count }
                }, { id: "SYSTEM", role: "CRON" });
            }

            logger.info({ pleId, date: dateStr }, "[ProviderFeeSettlementService] Settlement successful");

        } catch (error: any) {
            logger.error({
                pleId,
                date: dateStr,
                error: error.message
            }, "[ProviderFeeSettlementService] Settlement failed");
            throw error;
        }
    }

    /**
     * Verify that all PLEs have a settlement transaction for the given date
     */
    static async verifySettlements(dateStr?: string) {
        if (!dateStr) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            dateStr = yesterday.toISOString().split('T')[0];
        }

        logger.info({ date: dateStr }, "[ProviderFeeSettlementService] Running verification");

        const allPles = await ProviderLegalEntityModel.find({}).select('id name');
        const settledPles = await TransactionModel.distinct('providerLegalEntityId', {
            type: { $in: [TransactionType.PLE_PAYIN_FEE_CHARGE, TransactionType.PLE_PAYOUT_FEE_CHARGE] },
            "meta.settlementDate": dateStr
        });

        const missing = allPles.filter(ple => !settledPles.includes(ple.id));

        if (missing.length > 0) {
            logger.error({
                date: dateStr,
                missingCount: missing.length,
                missing: missing.map(m => m.id)
            }, "[ProviderFeeSettlementService] Verification FAILED");
        } else {
            logger.info({ date: dateStr }, "[ProviderFeeSettlementService] Verification PASSED");
        }

        return {
            total: allPles.length,
            settled: settledPles.length,
            missing
        };
    }
}
