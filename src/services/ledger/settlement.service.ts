import { LedgerService } from "@/services/ledger/ledger.service";
import { AccountManagerService } from "@/services/ledger/account-manager.service";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import { TransactionType, TransactionEntityType } from "@/constants/transaction.constant";
import { LedgerAccountModel } from "@/models/ledger-account.model";
import { ACCOUNT_TYPE } from "@/constants/tigerbeetle.constant";
import { AppError } from "@/utils/error";
import { Result, ok, err } from "@/utils/result";

export class SettlementService {

    // 1. Merchant Settlement: Debit Payin, Credit Payout
    static async settleMerchant(merchantId: string, amount: number, actorId: string): Promise<Result<any, AppError>> {
        try {
            const accounts = await AccountManagerService.getMerchantAccounts(merchantId);
            const payinAcc = accounts.find(a => a.typeSlug === ACCOUNT_TYPE.MERCHANT_PAYIN.slug);
            const payoutAcc = accounts.find(a => a.typeSlug === ACCOUNT_TYPE.MERCHANT_PAYOUT.slug);

            if (!payinAcc || !payoutAcc) return err(new AppError("Merchant accounts not found"));

            const transfer = await LedgerService.createTransfer(
                payinAcc.accountId,
                payoutAcc.accountId,
                BigInt(amount * 100), // Assuming input is standard units
                undefined,
                {
                    actorId,
                    actorType: "ADMIN",
                    reason: "Merchant Settlement",
                    actorName: "System Admin"
                }
            );

            // Optional: Create Transaction Record for visibility
            await TransactionModel.create({
                sourceEntityId: merchantId,
                sourceEntityType: TransactionEntityType.MERCHANT,
                destinationEntityId: merchantId,
                destinationEntityType: TransactionEntityType.MERCHANT, // Self-transfer
                type: TransactionType.MERCHANT_SETTLEMENT,
                amount,
                netAmount: amount,
                status: TransactionStatus.SUCCESS,
                providerRef: transfer.id.toString(),
                meta: { description: "Merchant Payin to Payout Settlement" }
            });

            return ok({ transferId: transfer.id.toString() });
        } catch (e: any) {
            return err(new AppError(e.message));
        }
    }

    // 2. Provider Settlement: Debit LE Main, Credit PLE Payin
    static async settleProvider(pleId: string, leId: string, amount: number, actorId: string): Promise<Result<any, AppError>> {
        try {
            const pleAccounts = await AccountManagerService.getProviderLegalEntityAccounts(pleId);
            const plePayin = pleAccounts.find(a => a.typeSlug === ACCOUNT_TYPE.PROVIDER_PAYIN.slug);

            const leAccounts = await AccountManagerService.getLegalEntityAccounts(leId);
            const leMain = leAccounts.find(a => a.typeSlug === ACCOUNT_TYPE.LEGAL_ENTITY_MAIN.slug);

            if (!plePayin || !leMain) return err(new AppError("Accounts not found"));

            const transfer = await LedgerService.createTransfer(
                leMain.accountId,
                plePayin.accountId,
                BigInt(amount * 100),
                undefined,
                { actorId, actorType: "ADMIN", reason: "Provider Settlement", actorName: "System" }
            );

            await TransactionModel.create({
                sourceEntityId: leId,
                sourceEntityType: TransactionEntityType.LEGAL_ENTITY,
                destinationEntityId: pleId,
                destinationEntityType: TransactionEntityType.PROVIDER_LEGAL_ENTITY,
                type: TransactionType.PROVIDER_SETTLEMENT,
                amount,
                netAmount: amount,
                status: TransactionStatus.SUCCESS,
                providerRef: transfer.id.toString(),
                meta: { description: "LE Main to PLE Payin Settlement" }
            });

            return ok({ transferId: transfer.id.toString() });
        } catch (e: any) {
            return err(new AppError(e.message));
        }
    }

    // 3. Provider Deposit: Debit LE Main, Credit PLE Payout
    static async depositProvider(pleId: string, leId: string, amount: number, actorId: string): Promise<Result<any, AppError>> {
        try {
            const pleAccounts = await AccountManagerService.getProviderLegalEntityAccounts(pleId);
            const plePayout = pleAccounts.find(a => a.typeSlug === ACCOUNT_TYPE.PROVIDER_PAYOUT.slug);

            const leAccounts = await AccountManagerService.getLegalEntityAccounts(leId);
            const leMain = leAccounts.find(a => a.typeSlug === ACCOUNT_TYPE.LEGAL_ENTITY_MAIN.slug);

            if (!plePayout || !leMain) return err(new AppError("Accounts not found"));

            const transfer = await LedgerService.createTransfer(
                leMain.accountId,
                plePayout.accountId,
                BigInt(amount * 100),
                undefined,
                { actorId, actorType: "ADMIN", reason: "Provider Deposit", actorName: "System" }
            );

            await TransactionModel.create({
                sourceEntityId: leId,
                sourceEntityType: TransactionEntityType.LEGAL_ENTITY,
                destinationEntityId: pleId,
                destinationEntityType: TransactionEntityType.PROVIDER_LEGAL_ENTITY,
                type: TransactionType.PROVIDER_TOPUP,
                amount,
                netAmount: amount,
                status: TransactionStatus.SUCCESS,
                providerRef: transfer.id.toString(),
                meta: { description: "LE Main to PLE Payout Deposit" }
            });

            return ok({ transferId: transfer.id.toString() });
        } catch (e: any) {
            return err(new AppError(e.message));
        }
    }

    // 4. Collect Merchant Fees: Debit Merchant (Payin/Payout), Credit System Income
    static async collectMerchantFees(merchantId: string, amount: number, type: "PAYIN" | "PAYOUT", txnId: string): Promise<Result<any, AppError>> {
        try {
            const accounts = await AccountManagerService.getMerchantAccounts(merchantId);
            const sourceAcc = type === "PAYIN"
                ? accounts.find(a => a.typeSlug === ACCOUNT_TYPE.MERCHANT_PAYIN.slug)
                : accounts.find(a => a.typeSlug === ACCOUNT_TYPE.MERCHANT_PAYOUT.slug);

            // TODO: Get Super Admin Income Account. For now assuming we look it up or provision it.
            // Let's assume a strictly defined "income" account exists.
            // We need a helper to get the Global Income Account.
            const incomeAccount = await LedgerAccountModel.findOne({ typeSlug: ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug }); // Assuming singleton

            if (!sourceAcc || !incomeAccount) return err(new AppError("Accounts not found"));

            const transfer = await LedgerService.createTransfer(
                sourceAcc.accountId,
                incomeAccount.accountId,
                BigInt(amount * 100),
                undefined,
                { actorId: "SYSTEM", actorType: "SYSTEM", reason: `Merchant Fees for ${txnId}`, actorName: "Fee Collector" }
            );

            // We don't usually act like a full Transaction for internal fees, but we can log it.
            return ok({ transferId: transfer.id.toString() });

        } catch (e: any) {
            return err(new AppError(e.message));
        }
    }

    // 5. Collect Provider Fees: Debit PLE (Payin/Payout), Credit PLE Expense
    static async collectProviderFees(pleId: string, amount: number, type: "PAYIN" | "PAYOUT", txnId: string): Promise<Result<any, AppError>> {
        try {
            const accounts = await AccountManagerService.getProviderLegalEntityAccounts(pleId);
            const sourceAcc = type === "PAYIN"
                ? accounts.find(a => a.typeSlug === ACCOUNT_TYPE.PROVIDER_PAYIN.slug)
                : accounts.find(a => a.typeSlug === ACCOUNT_TYPE.PROVIDER_PAYOUT.slug);

            const expenseAcc = accounts.find(a => a.typeSlug === ACCOUNT_TYPE.PROVIDER_EXPENSE.slug);

            if (!sourceAcc || !expenseAcc) return err(new AppError("Accounts not found"));

            const transfer = await LedgerService.createTransfer(
                sourceAcc.accountId,
                expenseAcc.accountId,
                BigInt(amount * 100),
                undefined,
                { actorId: "SYSTEM", actorType: "SYSTEM", reason: `Provider Fees for ${txnId}`, actorName: "Fee Collector" }
            );

            return ok({ transferId: transfer.id.toString() });

        } catch (e: any) {
            return err(new AppError(e.message));
        }
    }
}
