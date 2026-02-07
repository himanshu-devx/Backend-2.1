import { Context } from 'hono';
import { LedgerEntryService, GetEntriesOptions } from '@/services/ledger/ledger-entry.service';

/**
 * GET /api/merchant/ledger/accounts/:accountId/entries
 * Get ledger entries for a specific account owned by the merchant
 */
export const getMyLedgerEntries = async (c: Context) => {
    try {
        const merchantId = c.get('id');
        const accountId = c.req.param('accountId');

        if (!accountId) {
            return c.json({ success: false, message: 'Account ID is required' }, 400);
        }

        const ownsAccount = await LedgerEntryService.verifyMerchantOwnership(merchantId, accountId);
        if (!ownsAccount) {
            return c.json({ success: false, message: 'You do not have access to this account' }, 403);
        }

        const query = c.req.query();
        const options: GetEntriesOptions = {
            page: query.page ? parseInt(query.page) : 1,
            limit: query.limit ? parseInt(query.limit) : 20,
            status: query.status as any,
            type: query.type as any,
            startDate: query.startDate,
            endDate: query.endDate,
            minAmount: query.minAmount ? parseFloat(query.minAmount) : undefined,
            maxAmount: query.maxAmount ? parseFloat(query.maxAmount) : undefined,
            description: query.description,
            sortBy: (query.sortBy as any) || 'createdAt',
            sortOrder: (query.sortOrder as any) || 'desc',
        };

        const result = await LedgerEntryService.getEntriesByAccountId(accountId, options);
        return c.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error fetching merchant ledger entries:', error);
        return c.json({ success: false, message: 'Failed to fetch ledger entries', error: error.message }, 500);
    }
};

/**
 * GET /api/merchant/ledger/entries/:entryId
 */
export const getMyLedgerEntry = async (c: Context) => {
    try {
        const merchantId = c.get('id');
        const entryId = c.req.param('entryId');

        if (!entryId) {
            return c.json({ success: false, message: 'Entry ID is required' }, 400);
        }

        const entry = await LedgerEntryService.getEntryById(entryId);
        if (!entry) {
            return c.json({ success: false, message: 'Ledger entry not found' }, 404);
        }

        const merchantOwnsEntry = entry.lines?.some((line: any) =>
            typeof line.accountId === "string" && line.accountId.includes(`:MERCHANT:${merchantId}:`)
        );
        if (!merchantOwnsEntry) {
            return c.json({ success: false, message: 'You do not have access to this entry' }, 403);
        }

        return c.json({ success: true, data: entry });
    } catch (error: any) {
        console.error('Error fetching merchant ledger entry:', error);
        return c.json({ success: false, message: 'Failed to fetch ledger entry', error: error.message }, 500);
    }
};

/**
 * GET /api/merchant/ledger/accounts/:accountId/statement
 */
export const getMyAccountStatement = async (c: Context) => {
    try {
        const merchantId = c.get('id');
        const accountId = c.req.param('accountId');
        const ownsAccount = await LedgerEntryService.verifyMerchantOwnership(merchantId, accountId);
        if (!ownsAccount) {
            return c.json({ success: false, message: 'You do not have access to this account' }, 403);
        }

        const { startDate, endDate, limit } = c.req.query();
        const statement = await LedgerEntryService.getAccountStatement(accountId, {
            startDate,
            endDate,
            limit: limit ? parseInt(limit) : 100
        });
        return c.json({ success: true, ...statement });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to fetch account statement', error: error.message }, 500);
    }
};

/**
 * GET /api/merchant/ledger/accounts/:accountId/general-ledger
 */
export const getMyGeneralLedger = async (c: Context) => {
    try {
        const merchantId = c.get('id');
        const accountId = c.req.param('accountId');
        const { startDate, endDate } = c.req.query();

        const ownsAccount = await LedgerEntryService.verifyMerchantOwnership(merchantId, accountId);
        if (!ownsAccount) {
            return c.json({ success: false, message: 'You do not have access to this account' }, 403);
        }

        const gl = await LedgerEntryService.getGeneralLedger(accountId, startDate, endDate);
        return c.json({ success: true, ...gl });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to fetch general ledger', error: error.message }, 500);
    }
};
