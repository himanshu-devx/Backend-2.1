import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { CacheService } from "@/services/common/cache.service";
import { ProviderClient } from "@/services/provider-config/provider-client.service";
import { PaymentLedgerService } from "@/services/payment/payment-ledger.service";
import { JobQueue } from "@/utils/job-queue.util";
import { MerchantCallbackService } from "@/services/payment/merchant-callback.service";
import { getISTDate } from "@/utils/date.util";
import { logger } from "@/infra/logger-instance";
import { ENV } from "@/config/env";
import { IST_OFFSET_MS } from "@/constants/common.constant";
import { redis } from "@/infra/redis-instance";
import { TransactionType } from "@/constants/transaction.constant";

const PAYIN_EXPIRE_DELAY_MS = Math.max(1, ENV.PAYIN_AUTO_EXPIRE_MINUTES || 30) * 60 * 1000;
const PAYOUT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const PAYOUT_POLL_WINDOW_MS = 30 * 60 * 1000;
const PAYOUT_POLL_IMMEDIATE_DELAY_MS = 1 * 60 * 1000;
const PAYOUT_POLL_MAX_ATTEMPTS = Math.floor(PAYOUT_POLL_WINDOW_MS / PAYOUT_POLL_INTERVAL_MS);
const PAYOUT_POLL_TTL_SECONDS = 2 * 24 * 60 * 60;

const payoutPollKey = (transactionId: string) => `txn:payout:poll:${transactionId}`;

type PayoutPollPayload = {
    transactionId: string;
    pollIndex?: number;
    maxPolls?: number;
    isEod?: boolean;
};

export class TransactionMonitorService {
    static async schedulePayinExpiry(transactionId: string) {
        await JobQueue.enqueueDelayed(
            {
                type: "PAYIN_AUTO_EXPIRE",
                payload: { transactionId }
            },
            PAYIN_EXPIRE_DELAY_MS
        );
    }

    static async schedulePayoutPolling(transactionId: string, pollImmediately: boolean) {
        await redis.setex(payoutPollKey(transactionId), PAYOUT_POLL_TTL_SECONDS, "1");
        const delayMs = pollImmediately ? PAYOUT_POLL_IMMEDIATE_DELAY_MS : PAYOUT_POLL_INTERVAL_MS;
        const maxPolls = pollImmediately ? PAYOUT_POLL_MAX_ATTEMPTS + 1 : PAYOUT_POLL_MAX_ATTEMPTS;
        await JobQueue.enqueueDelayed(
            {
                type: "PAYOUT_STATUS_POLL",
                payload: {
                    transactionId,
                    pollIndex: 0,
                    maxPolls,
                    isEod: false
                } as PayoutPollPayload
            },
            delayMs
        );
    }

    static async stopPayoutPolling(transactionId: string) {
        await redis.del(payoutPollKey(transactionId));
    }

    static async processPayinAutoExpire(transactionId: string) {
        const transaction = await TransactionModel.findOne({ id: transactionId });
        if (!transaction) return;

        if (transaction.status !== TransactionStatus.PENDING && transaction.status !== TransactionStatus.PROCESSING) {
            return;
        }

        transaction.status = TransactionStatus.EXPIRED;
        transaction.error = "Webhook not received - auto expired";
        transaction.events.push({
            type: "AUTO_EXPIRED_NO_WEBHOOK",
            timestamp: getISTDate(),
            payload: { reason: "Webhook not received" }
        });
        await transaction.save();

        MerchantCallbackService.notify(transaction, { source: "AUTO_EXPIRE" });

        logger.info(
            {
                event: "payin.auto_expire",
                source: "AUTO_EXPIRE",
                transactionId: transaction.id,
                orderId: transaction.orderId
            },
            "[TransactionMonitor] Payin auto-expired"
        );
    }

    static async sweepExpiredPayins(limit: number = 500) {
        const cutoff = new Date(Date.now() - PAYIN_EXPIRE_DELAY_MS);
        const pending = await TransactionModel.find({
            type: TransactionType.PAYIN,
            status: { $in: [TransactionStatus.PENDING, TransactionStatus.PROCESSING] },
            createdAt: { $lte: cutoff }
        })
            .select({ id: 1 })
            .limit(limit);

        let expired = 0;
        for (const txn of pending) {
            await this.processPayinAutoExpire(txn.id);
            expired += 1;
        }

        logger.info(
            { cutoff, scanned: pending.length, expired },
            "[TransactionMonitor] Payin expiry sweep completed"
        );

        return { cutoff, scanned: pending.length, expired };
    }

    static async processPayoutStatusPoll(payload: PayoutPollPayload) {
        const transaction = await TransactionModel.findOne({ id: payload.transactionId });
        if (!transaction) return;

        if (transaction.status !== TransactionStatus.PENDING && transaction.status !== TransactionStatus.PROCESSING) {
            await this.stopPayoutPolling(transaction.id);
            return;
        }

        const pollingActive = await redis.get(payoutPollKey(transaction.id));
        if (!pollingActive) return;

        if (!transaction.providerLegalEntityId) return;

        const ple = await CacheService.getChannelById(transaction.providerLegalEntityId);
        if (!ple) return;

        const provider = await ProviderClient.getProviderForRouting(
            ple.providerId,
            ple.legalEntityId
        );

        logger.info(
            {
                event: "payout.status_poll.start",
                source: "STATUS_POLL",
                transactionId: transaction.id,
                orderId: transaction.orderId,
                providerId: ple.providerId,
                legalEntityId: ple.legalEntityId,
                pollIndex: payload.pollIndex,
                isEod: payload.isEod
            },
            "[TransactionMonitor] Polling payout status"
        );

        const statusRequest = {
            transactionId: transaction.id,
            providerTransactionId: transaction.providerRef,
        };

        const result = await ProviderClient.execute(ple.id, "status", () =>
            provider.checkPayoutStatus(statusRequest)
        );

        if (!result?.status || result.status === "PENDING") {
            await this.scheduleNextPoll(payload);
            return;
        }

        if (result.status === "SUCCESS") {
            transaction.status = TransactionStatus.SUCCESS;
            transaction.utr = result.utr || transaction.utr;
            transaction.events.push({
                type: "STATUS_POLL_SUCCESS",
                timestamp: getISTDate(),
                payload: result
            });
            await PaymentLedgerService.commitPayout(transaction);
            await transaction.save();
            MerchantCallbackService.notify(transaction, { source: "STATUS_POLL" });
            await this.stopPayoutPolling(transaction.id);
            logger.info(
                {
                    event: "payout.status_poll.update",
                    source: "STATUS_POLL",
                    transactionId: transaction.id,
                    orderId: transaction.orderId,
                    status: transaction.status,
                    providerId: ple.providerId,
                    legalEntityId: ple.legalEntityId
                },
                "[TransactionMonitor] Payout updated from status poll"
            );
            return;
        }

        if (result.status === "FAILED" || result.status === "EXPIRED") {
            transaction.status = result.status as any;
            transaction.utr = result.utr || transaction.utr;
            transaction.error = result.message || (result.status === "EXPIRED"
                ? "Provider reported expired"
                : "Provider reported failure");
            transaction.events.push({
                type: result.status === "EXPIRED" ? "STATUS_POLL_EXPIRED" : "STATUS_POLL_FAILED",
                timestamp: getISTDate(),
                payload: result
            });
            await PaymentLedgerService.voidPayout(transaction);
            await transaction.save();
            MerchantCallbackService.notify(transaction, { source: "STATUS_POLL" });
            await this.stopPayoutPolling(transaction.id);
            logger.info(
                {
                    event: "payout.status_poll.update",
                    source: "STATUS_POLL",
                    transactionId: transaction.id,
                    orderId: transaction.orderId,
                    status: transaction.status,
                    providerId: ple.providerId,
                    legalEntityId: ple.legalEntityId
                },
                "[TransactionMonitor] Payout updated from status poll"
            );
            return;
        }

        await this.scheduleNextPoll(payload);
    }

    private static async scheduleNextPoll(payload: PayoutPollPayload) {
        if (payload.isEod) return;

        const pollIndex = payload.pollIndex ?? 0;
        const maxPolls = payload.maxPolls ?? PAYOUT_POLL_MAX_ATTEMPTS;
        const nextIndex = pollIndex + 1;

        if (nextIndex < maxPolls) {
            const pollingActive = await redis.get(payoutPollKey(payload.transactionId));
            if (!pollingActive) return;
            await JobQueue.enqueueDelayed(
                {
                    type: "PAYOUT_STATUS_POLL",
                    payload: { ...payload, pollIndex: nextIndex }
                },
                PAYOUT_POLL_INTERVAL_MS
            );
            return;
        }

        const delayMs = this.getEodDelayMs();
        if (delayMs <= 0) return;

        const pollingActive = await redis.get(payoutPollKey(payload.transactionId));
        if (!pollingActive) return;

        await JobQueue.enqueueDelayed(
            {
                type: "PAYOUT_STATUS_POLL",
                payload: { ...payload, pollIndex: nextIndex, isEod: true }
            },
            delayMs
        );
    }

    private static getEodDelayMs(): number {
        const now = new Date();
        const istNow = new Date(now.getTime() + IST_OFFSET_MS);
        const istEod = new Date(istNow);
        istEod.setUTCHours(23, 59, 0, 0);
        let eodUtc = new Date(istEod.getTime() - IST_OFFSET_MS);

        if (eodUtc.getTime() <= now.getTime()) {
            eodUtc = new Date(eodUtc.getTime() + 24 * 60 * 60 * 1000);
        }

        return eodUtc.getTime() - now.getTime();
    }
}
