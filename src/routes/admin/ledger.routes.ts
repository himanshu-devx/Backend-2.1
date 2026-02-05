import { Hono } from 'hono';
import { authorizeRoles } from '@/middlewares/auth.middleware';
import { handler } from '@/utils/handler';
import * as ledgerController from '@/controllers/admin/ledger.controller';
import { ADMIN_ROLES } from '@/constants/users.constant';

const adminLedgerRoutes = new Hono();

// Get entries for a specific account
adminLedgerRoutes.get(
    '/accounts/:accountId/entries',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler(ledgerController.getLedgerEntries)
);

// Get Account Statement
adminLedgerRoutes.get(
    '/accounts/:accountId/statement',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler(ledgerController.getAccountStatement)
);

// Get General Ledger
adminLedgerRoutes.get(
    '/accounts/:accountId/general-ledger',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler(ledgerController.getGeneralLedger)
);

// Get a specific entry by ID
adminLedgerRoutes.get(
    '/entries/:entryId',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler(ledgerController.getLedgerEntry)
);

// Reports
adminLedgerRoutes.get(
    '/reports/trial-balance',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN]),
    handler(ledgerController.getTrialBalance)
);

adminLedgerRoutes.get(
    '/reports/balance-sheet',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN]),
    handler(ledgerController.getBalanceSheet)
);

export default adminLedgerRoutes;
