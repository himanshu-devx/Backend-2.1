import { OutboxModel, OutboxStatus, OutboxDocument } from "@/models/outbox.model";
import { logger } from "@/infra/logger-instance";

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

export class OutboxService {
  static async enqueue(
    type: string,
    payload: any,
    dedupeKey: string,
    maxAttempts = 8
  ) {
    try {
      const existing = await OutboxModel.findOne({ dedupeKey });
      if (existing) return existing;

      const doc = new OutboxModel({
        type,
        payload,
        dedupeKey,
        maxAttempts,
        status: OutboxStatus.PENDING,
        nextAttemptAt: new Date(),
      });
      await doc.save();
      return doc;
    } catch (error: any) {
      logger.error({ type, dedupeKey, error: error?.message }, "[Outbox] Enqueue failed");
      throw error;
    }
  }

  static async claimNext(): Promise<OutboxDocument | null> {
    const now = new Date();
    const doc = await OutboxModel.findOneAndUpdate(
      {
        status: OutboxStatus.PENDING,
        nextAttemptAt: { $lte: now },
      },
      {
        $set: { status: OutboxStatus.PROCESSING },
        $inc: { attempts: 1 },
      },
      { sort: { nextAttemptAt: 1 }, new: true }
    );
    return doc;
  }

  static async markSuccess(doc: OutboxDocument) {
    await OutboxModel.updateOne(
      { id: doc.id },
      { $set: { status: OutboxStatus.SENT, lastError: null } }
    );
  }

  static async markFailed(doc: OutboxDocument, errorMsg: string) {
    const attempts = doc.attempts ?? 1;
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempts - 1));
    const nextAttemptAt = new Date(Date.now() + delay);
    const status =
      attempts >= (doc.maxAttempts ?? 8) ? OutboxStatus.FAILED : OutboxStatus.PENDING;

    await OutboxModel.updateOne(
      { id: doc.id },
      {
        $set: {
          status,
          lastError: errorMsg,
          nextAttemptAt,
        },
      }
    );
  }
}
