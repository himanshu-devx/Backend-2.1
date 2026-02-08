import { Context } from 'hono';
import { LedgerEntryService, GetEntriesOptions } from '@/services/ledger/ledger-entry.service';
import { LedgerTransferService } from '@/services/ledger/ledger-transfer.service';
import { CreateLedgerTransferDTO } from '@/dto/ledger/ledger-transfer.dto';
import { LedgerOperationService } from '@/services/ledger/ledger-operation.service';
import { CreateLedgerOperationDTO } from '@/dto/ledger/ledger-operation.dto';

/**
 * GET /api/admin/ledger/accounts/:accountId/entries
 */
export const getLedgerEntries = async (c: Context) => {
    try {
        const accountId = c.req.param('accountId');
        if (!accountId) {
            return c.json({ success: false, message: 'Account ID is required' }, 400);
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
        return c.json({ success: false, message: 'Failed to fetch ledger entries', error: error.message }, 500);
    }
};

/**
 * GET /api/admin/ledger/entries/:entryId
 */
export const getLedgerEntry = async (c: Context) => {
    try {
        const entryId = c.req.param('entryId');
        if (!entryId) {
            return c.json({ success: false, message: 'Entry ID is required' }, 400);
        }

        const entry = await LedgerEntryService.getEntryById(entryId);
        if (!entry) {
            return c.json({ success: false, message: 'Ledger entry not found' }, 404);
        }

        return c.json({ success: true, data: entry });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to fetch ledger entry', error: error.message }, 500);
    }
};

/**
 * GET /api/admin/ledger/accounts/:accountId/statement
 */
export const getAccountStatement = async (c: Context) => {
    try {
        const accountId = c.req.param('accountId');
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
 * GET /api/admin/ledger/accounts/:accountId/general-ledger
 */
export const getGeneralLedger = async (c: Context) => {
    try {
        const accountId = c.req.param('accountId');
        const { startDate, endDate } = c.req.query();

        const gl = await LedgerEntryService.getGeneralLedger(accountId, startDate, endDate);
        return c.json({ success: true, ...gl });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to fetch general ledger', error: error.message }, 500);
    }
};

/**
 * GET /api/admin/ledger/reports/trial-balance
 */
export const getTrialBalance = async (c: Context) => {
    try {
        const report = await LedgerEntryService.getTrialBalance();
        return c.json({ success: true, data: report });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to fetch trial balance', error: error.message }, 500);
    }
};

/**
 * GET /api/admin/ledger/reports/balance-sheet
 */
export const getBalanceSheet = async (c: Context) => {
    try {
        const report = await LedgerEntryService.getBalanceSheet();
        return c.json({ success: true, data: report });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to fetch balance sheet', error: error.message }, 500);
    }
};

/**
 * POST /api/admin/ledger/transfers
 */
export const createLedgerTransfer = async (c: Context) => {
    const body = c.get('validatedBody') as CreateLedgerTransferDTO;
    const actor = {
        id: c.get('id'),
        email: c.get('email'),
        role: c.get('role'),
    };

    const result = await LedgerTransferService.createTransfer(body, actor);
    return c.json({ success: true, data: result });
};

/**
 * POST /api/admin/ledger/operations
 */
export const createLedgerOperation = async (c: Context) => {
    const body = c.get('validatedBody') as CreateLedgerOperationDTO;
    const actor = {
        id: c.get('id'),
        email: c.get('email'),
        role: c.get('role'),
    };

    const result = await LedgerOperationService.createOperation(body, actor);
    return c.json({ success: true, data: result });
};
