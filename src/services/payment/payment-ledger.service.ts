import { TransactionDocument } from "@/models/transaction.model";
import { LedgerService } from "@/services/ledger/ledger.service";
import { LedgerUtils } from "@/utils/ledger.utils";
import { ENTITY_TYPE, ENTITY_ACCOUNT_TYPE } from "@/constants/ledger.constant";
import { AccountType } from "fintech-ledger";
import { getISTDate } from "@/utils/date.util";
import { toDisplayAmount } from "@/utils/money.util";

export class PaymentLedgerService {
    /**
     * Finalize Payin: Move funds from Provider Asset to Merchant Liability
     * Triggered via Webhook
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
            // Use natural casing as per update in ProviderLegalEntity service
            `${transaction.providerId}_${transaction.legalEntityId}`,
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

        const txnNetAmount = toDisplayAmount(transaction.netAmount);
        const merchantFeeTotal = toDisplayAmount(merchantFees.total);
        const credits = [
            { accountId: merchantPayinAccountId, amount: txnNetAmount as any }
        ];
        if (merchantFeeTotal > 0) {
            credits.push({ accountId: platformIncomeId, amount: merchantFeeTotal as any });
        }

        const entryId = await LedgerService.transfer({
            narration: `Payin Success: ${transaction.orderId}`,
            externalRef: transaction.id,
            valueDate: getISTDate(),
            debits: [{ accountId: providerSettlementId, amount: toDisplayAmount(transaction.amount) as any }],
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
     * Initiate Payout: Reserve funds via PENDING ledger entry
     * Debit: Merchant Payout (Liability) - reserve merchant funds
     * Credit: Provider Payout (Asset) - provider will send funds
     * Credit: Income - platform fees
     */
    static async initiatePayout(transaction: TransactionDocument) {
        const sourceId = LedgerUtils.generateAccountId(ENTITY_TYPE.MERCHANT, transaction.merchantId as string, AccountType.LIABILITY, ENTITY_ACCOUNT_TYPE.PAYOUT);
        const providerSettlementId = LedgerUtils.generateAccountId(ENTITY_TYPE.PROVIDER, (transaction.providerLegalEntityId || transaction.providerId)!.toLowerCase(), AccountType.ASSET, ENTITY_ACCOUNT_TYPE.PAYOUT);
        const platformIncomeId = LedgerUtils.generateAccountId(ENTITY_TYPE.INCOME, "INCOME", AccountType.INCOME, ENTITY_ACCOUNT_TYPE.INCOME);

        const merchantFees = transaction.fees?.merchantFees;
        const txnAmount = toDisplayAmount(transaction.amount);
        const txnNetAmount = toDisplayAmount(transaction.netAmount);
        const merchantFeeTotal = merchantFees ? toDisplayAmount(merchantFees.total) : 0;

        const credits = [
            { accountId: providerSettlementId, amount: txnAmount as any } // Provider sends full amount to beneficiary
        ];

        // If including fees, we debit (amount + fees) from merchant, credit `amount` to provider, `fees` to income
        // Logic: Net Amount deducted from Merchant = Amount + Fees
        if (merchantFeeTotal > 0) {
            credits.push({ accountId: platformIncomeId, amount: merchantFeeTotal as any });
        }

        const entryId = await LedgerService.transfer({
            narration: `Payout Initiated: ${transaction.orderId}`,
            externalRef: transaction.id,
            valueDate: getISTDate(),
            debits: [{ accountId: sourceId, amount: txnNetAmount as any }], // Deduct total cost
            credits: credits,
            status: "PENDING"
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
     * Commit Payout: Mark PENDING entry as POSTED
     */
    static async commitPayout(transaction: TransactionDocument) {
        const entryId = transaction.meta?.get("ledgerEntryId") || (transaction.meta as any)?.ledgerEntryId;
        if (!entryId) return; // No pending entry to commit

        await LedgerService.post(entryId);

        if (transaction?.meta?.set) {
            transaction.meta.set("ledgerExectued", true);
        } else if (transaction?.meta) {
            (transaction.meta as any).ledgerExecuted = true;
        }
        await transaction.save();
        return entryId;
    }

    /**
     * Void Payout: Mark PENDING entry as VOID (Releasing funds)
     */
    static async voidPayout(transaction: TransactionDocument) {
        const entryId = transaction.meta?.get("ledgerEntryId") || (transaction.meta as any)?.ledgerEntryId;
        if (!entryId) return; // No pending entry to void

        await LedgerService.void(entryId);

        if (transaction?.meta?.set) {
            transaction.meta.set("ledgerVoided", true);
        } else if (transaction?.meta) {
            (transaction.meta as any).ledgerVoided = true;
        }
        await transaction.save();
        return entryId;
    }
}
