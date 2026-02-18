import { OutboxService } from "@/services/common/outbox.service";
import { OUTBOX_TYPES } from "@/constants/outbox.constant";
import { TransactionDocument, TransactionStatus } from "@/models/transaction.model";

export class TransactionOutboxService {
  static async enqueueMerchantCallback(transaction: TransactionDocument) {
    const status = transaction.status;
    if (!status) return;
    const dedupeKey = `callback:${transaction.id}:${status}`;
    await OutboxService.enqueue(
      OUTBOX_TYPES.MERCHANT_CALLBACK,
      {
        transactionId: transaction.id,
        merchantId: transaction.merchantId,
      },
      dedupeKey
    );
  }

  static async enqueueLedgerAction(transaction: TransactionDocument) {
    if (transaction.status === TransactionStatus.SUCCESS) {
      if (transaction.type === "PAYIN") {
        const dedupeKey = `ledger:payin:${transaction.id}:success`;
        await OutboxService.enqueue(
          OUTBOX_TYPES.LEDGER_PAYIN_CREDIT,
          { transactionId: transaction.id },
          dedupeKey
        );
      } else {
        const dedupeKey = `ledger:payout:${transaction.id}:commit`;
        await OutboxService.enqueue(
          OUTBOX_TYPES.LEDGER_PAYOUT_COMMIT,
          { transactionId: transaction.id },
          dedupeKey
        );
      }
    }

    if (transaction.status === TransactionStatus.FAILED && transaction.type === "PAYOUT") {
      const dedupeKey = `ledger:payout:${transaction.id}:void`;
      await OutboxService.enqueue(
        OUTBOX_TYPES.LEDGER_PAYOUT_VOID,
        { transactionId: transaction.id },
        dedupeKey
      );
    }
  }
}
