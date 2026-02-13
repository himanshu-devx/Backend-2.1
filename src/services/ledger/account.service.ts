import { LedgerService } from './ledger.service';
import { AccountStatus, AccountType } from 'fintech-ledger';
import {
    ENTITY_ACCOUNT_TYPE,
    ENTITY_DEFAULT_ACCOUNT_TYPE,
    PURPOSE_ACCOUNT_TYPE_OVERRIDE,
    ENTITY_ALLOWED_ACCOUNT_PURPOSES,
    ENTITY_TYPE,
    LedgerAccountEntity,
} from '@/constants/ledger.constant';
import { LedgerUtils } from '@/utils/ledger.utils';
import { toDisplayAmountFromLedger } from '@/utils/money.util';

export class AccountService {

    // =====================================================
    // INTERNAL HELPERS
    // =====================================================

    private static resolveAccountType(
        entityType: LedgerAccountEntity | string,
        purpose: string,
        explicit?: AccountType
    ): AccountType {
        if (explicit) return explicit;

        return (
            PURPOSE_ACCOUNT_TYPE_OVERRIDE[purpose as keyof typeof PURPOSE_ACCOUNT_TYPE_OVERRIDE] ??
            ENTITY_DEFAULT_ACCOUNT_TYPE[entityType as keyof typeof ENTITY_DEFAULT_ACCOUNT_TYPE]
        );
    }

    private static assertPurposeAllowed(
        entityType: LedgerAccountEntity,
        purpose: string
    ) {
        const allowed = ENTITY_ALLOWED_ACCOUNT_PURPOSES[entityType] as ReadonlyArray<string>;
        if (!allowed || !allowed.includes(purpose)) {
            throw new Error(
                `Purpose ${purpose} is not allowed for entity ${entityType}`
            );
        }
    }

    private static async createAccount(params: {
        entityType: LedgerAccountEntity;
        entityId: string;
        name: string;
        purpose: string;
        type?: AccountType;
        allowOverdraft: boolean;
        actorId: string;
    }) {
        this.assertPurposeAllowed(params.entityType, params.purpose);

        const type = this.resolveAccountType(
            params.entityType,
            params.purpose,
            params.type
        );

        const id = LedgerUtils.generateAccountId(
            params.entityType,
            params.entityId,
            type,
            params.purpose
        );

        const code = LedgerUtils.generateAccountCode(
            params.entityType,
            params.name,
            params.entityId,
            params.purpose
        );

        // Idempotent create: if account already exists, reuse it
        const existing = await LedgerService.getAccountById(id).catch(() => null);
        if (!existing) {
            try {
                await LedgerService.createAccount({
                    id,
                    code,
                    type,
                    status: AccountStatus.ACTIVE,
                    allowOverdraft: params.allowOverdraft,
                    actorId: params.actorId,
                });
            } catch (error: any) {
                // If it's a duplicate key error (Postgres 23505) on code or id, we assume it exists and return ID
                if (error?.code === '23505' || error?.message?.includes('unique constraint')) {
                    // Log warning but proceed
                    console.warn(`[AccountService] Account ${id} (Code: ${code}) already exists. Reusing.`);
                    return id;
                }
                throw error;
            }
        }

        return id;
    }

    // =====================================================
    // LEGAL ENTITY
    // =====================================================

    static async createLegalEntityAccount(
        legalEntityId: string,
        name: string,
        actorId = 'system'
    ) {
        const id = await this.createAccount({
            entityType: ENTITY_TYPE.LEGAL_ENTITY,
            entityId: legalEntityId,
            name,
            purpose: ENTITY_ACCOUNT_TYPE.BANK,
            type: AccountType.EQUITY,
            allowOverdraft: true,
            actorId,
        });

        return LedgerService.getAccountById(id);
    }

    // =====================================================
    // WORLD / SYSTEM
    // =====================================================

    static async createWorldAccounts(actorId = 'system') {
        const [worldId, incomeId] = await Promise.all([
            this.createAccount({
                entityType: ENTITY_TYPE.WORLD,
                entityId: 'WORLD',
                name: 'WORLD',
                purpose: ENTITY_ACCOUNT_TYPE.WORLD,
                type: AccountType.OFF_BALANCE,
                allowOverdraft: true,
                actorId,
            }),
            this.createAccount({
                entityType: ENTITY_TYPE.INCOME,
                entityId: 'INCOME',
                name: 'INCOME',
                purpose: ENTITY_ACCOUNT_TYPE.INCOME,
                type: AccountType.INCOME,
                allowOverdraft: false,
                actorId,
            })
        ]);

        const accounts = await LedgerService.getAccountByIds([worldId, incomeId]);

        return {
            world: accounts.find(a => a.id === worldId)!,
            income: accounts.find(a => a.id === incomeId)!,
        };
    }

    // =====================================================
    // MERCHANT
    // =====================================================

    static async createMerchantAccounts(
        merchantId: string,
        merchantName: string,
        actorId = 'system'
    ) {
        const create = (purpose: string) =>
            this.createAccount({
                entityType: ENTITY_TYPE.MERCHANT,
                entityId: merchantId,
                name: merchantName,
                purpose,
                allowOverdraft: false,
                actorId,
            });

        const [payinId, payoutId, holdId] = await Promise.all([
            create(ENTITY_ACCOUNT_TYPE.PAYIN),
            create(ENTITY_ACCOUNT_TYPE.PAYOUT),
            create(ENTITY_ACCOUNT_TYPE.HOLD),
        ]);

        const accounts = await LedgerService.getAccountByIds([payinId, payoutId, holdId]);

        return {
            payin: accounts.find(a => a.id === payinId)!,
            payout: accounts.find(a => a.id === payoutId)!,
            hold: accounts.find(a => a.id === holdId)!,
        };
    }

    // =====================================================
    // PROVIDER
    // =====================================================

    static async createProviderAccounts(
        providerId: string,
        providerName: string,
        actorId = 'system'
    ) {
        const create = (purpose: string) =>
            this.createAccount({
                entityType: ENTITY_TYPE.PROVIDER,
                entityId: providerId,
                name: providerName,
                purpose,
                allowOverdraft: true,
                actorId,
            });

        const [payinId, payoutId, expenseId] = await Promise.all([
            create(ENTITY_ACCOUNT_TYPE.PAYIN),
            create(ENTITY_ACCOUNT_TYPE.PAYOUT),
            create(ENTITY_ACCOUNT_TYPE.EXPENSE),
        ]);

        const accounts = await LedgerService.getAccountByIds([payinId, payoutId, expenseId]);

        return {
            payin: accounts.find(a => a.id === payinId)!,
            payout: accounts.find(a => a.id === payoutId)!,
            expense: accounts.find(a => a.id === expenseId)!,
        };
    }

    // =====================================================
    // QUERY HELPERS (ALL SCENARIOS)
    // =====================================================

    /**
     * entityType + entityId → all accounts
     */
    static async getAccountsByEntity(
        entityType: LedgerAccountEntity,
        entityId: string
    ) {
        const purposes = ENTITY_ALLOWED_ACCOUNT_PURPOSES[entityType];

        const ids = purposes.map(purpose => {
            const type = this.resolveAccountType(entityType, purpose);
            return LedgerUtils.generateAccountId(
                entityType,
                entityId,
                type,
                purpose
            );
        });

        return LedgerService.getAccountByIds(ids);
    }
    /**
     * entityType + entityId + purpose → single account
     */
    static getSingleAccount(
        entityType: LedgerAccountEntity,
        entityId: string,
        purpose: string
    ) {
        this.assertPurposeAllowed(entityType, purpose);

        const type = this.resolveAccountType(entityType, purpose);
        const id = LedgerUtils.generateAccountId(
            entityType,
            entityId,
            type,
            purpose
        );

        return LedgerService.getAccountById(id);
    }

    static getAccountByAccountId(accountId: string) {
        return LedgerService.getAccountById(accountId);
    }

    static getAccountsByIds(accountIds: string[]) {
        return LedgerService.getAccountByIds(accountIds);
    }

    /**
     * Get balances for multiple account IDs
     * Returns a map of accountId -> balance
     */
    static async getAccountBalances(accountIds: string[]): Promise<Record<string, string>> {
        try {
            const validIds = accountIds.filter(id => id);
            if (validIds.length === 0) return {};

            const accounts = await LedgerService.getAccountByIds(validIds);
            const balances: Record<string, string> = {};

            for (const account of accounts) {
                const rawBalance = (account as any).ledgerBalance ?? 0;
                const rupeeBalance = toDisplayAmountFromLedger(rawBalance);
                balances[account.id] = rupeeBalance.toFixed(2);
            }

            return balances;
        } catch (error) {
            console.error('Failed to get account balances:', error);
            return {};
        }
    }
}
