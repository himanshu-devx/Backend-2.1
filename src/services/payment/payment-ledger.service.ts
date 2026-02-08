import { TransactionDocument } from "@/models/transaction.model";
import { LedgerService } from "@/services/ledger/ledger.service";
import { LedgerUtils } from "@/utils/ledger.utils";
import { ENTITY_TYPE, ENTITY_ACCOUNT_TYPE } from "@/constants/ledger.constant";
import { AccountType } from "fintech-ledger";
import { getISTDate } from "@/utils/date.util";

export class PaymentLedgerService {
    /**
     * Finalize Payin: Move funds from Provider Asset to Merchant Liability
     */
    static async processPayinCredit(transaction: TransactionDocument) {
        const merchantPayinAccountId = LedgerUtils.generateAccountId(
            ENTITY_TYPE.MERCHANT,
            transaction.merchantId as string,
            AccountType.LIABILITY,
            ENTITY_ACCOUNT_TYPE.PAYIN
        );

        const providerSettlementId = LedgerUtils.generateAccountId(
            ENTITY_TYPE.PROVIDER,
            transaction.providerId!,
            AccountType.ASSET,
            ENTITY_ACCOUNT_TYPE.PAYIN
        );

        const platformIncomeId = LedgerUtils.generateAccountId(
            ENTITY_TYPE.INCOME,
            "INCOME",
            AccountType.INCOME,
            ENTITY_ACCOUNT_TYPE.INCOME
        );

        const merchantFees = transaction.fees?.merchantFees;
        if (!merchantFees) throw new Error("Merchant fees not found");

        const credits = [
            { accountId: merchantPayinAccountId, amount: transaction.netAmount as any }
        ];
        if (Number(merchantFees.total) > 0) {
            credits.push({ accountId: platformIncomeId, amount: merchantFees.total as any });
        }

        const entryId = await LedgerService.transfer({
            narration: `Payin Success: ${transaction.orderId}`,
            externalRef: transaction.id,
            valueDate: getISTDate(),
            debits: [{ accountId: providerSettlementId, amount: transaction.amount as any }],
            credits,
            status: "POSTED"
        });
        if (transaction?.meta?.set) {
            transaction.meta.set("ledgerEntryId", entryId);
        } else if (transaction?.meta) {
            (transaction.meta as any).ledgerEntryId = entryId;
        }
        await transaction.save();
        return entryId;
    }

    /**
     * Finalize Payout: Move funds from Merchant Hold to Provider Asset
     */
    static async commitPayout(transaction: TransactionDocument) {
        const holdId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, transaction.merchantId as string, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.HOLD);
        const providerSettlementId = LedgerUtils.generateAccountId(ENTITY_TYPE.PROVIDER, transaction.providerId!, AccountType.ASSET, ENTITY_ACCOUNT_TYPE.PAYOUT);

        const entryId = await LedgerService.transfer({
            narration: `Payout Commit: ${transaction.orderId}`,
            externalRef: transaction.id,
            valueDate: getISTDate(),
            debits: [{ accountId: holdId, amount: transaction.netAmount as any }],
            credits: [{ accountId: providerSettlementId, amount: transaction.netAmount as any }],
            status: "POSTED"
        });
        if (transaction?.meta?.set) {
            transaction.meta.set("ledgerCommitEntryId", entryId);
        } else if (transaction?.meta) {
            (transaction.meta as any).ledgerCommitEntryId = entryId;
        }
        await transaction.save();
        return entryId;
    }

    /**
     * Rollback Payout: Move funds from Merchant Hold back to Merchant Payin
     */
    static async rollbackPayout(transaction: TransactionDocument) {
        const sourceId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, transaction.merchantId as string, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.PAYIN);
        const holdId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, transaction.merchantId as string, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.HOLD);

        const entryId = await LedgerService.transfer({
            narration: `Payout Rollback: ${transaction.orderId}`,
            externalRef: transaction.id,
            valueDate: getISTDate(),
            debits: [{ accountId: holdId, amount: transaction.netAmount as any }],
            credits: [{ accountId: sourceId, amount: transaction.netAmount as any }],
            status: "POSTED"
        });
        if (transaction?.meta?.set) {
            transaction.meta.set("ledgerRollbackEntryId", entryId);
        } else if (transaction?.meta) {
            (transaction.meta as any).ledgerRollbackEntryId = entryId;
        }
        await transaction.save();
        return entryId;
    }
}
