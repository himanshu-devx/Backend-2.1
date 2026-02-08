import { Hono } from 'hono';
import { authorizeRoles } from '@/middlewares/auth.middleware';
import { handler } from '@/utils/handler';
import * as ledgerController from '@/controllers/admin/ledger.controller';
import { ADMIN_ROLES } from '@/constants/users.constant';
import { validateBody } from '@/middlewares/validate';
import { CreateLedgerTransferSchema } from '@/dto/ledger/ledger-transfer.dto';
import { CreateLedgerOperationSchema } from '@/dto/ledger/ledger-operation.dto';

const adminLedgerRoutes = new Hono();

// Create a manual ledger transfer
adminLedgerRoutes.post(
    '/transfers',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    validateBody(CreateLedgerTransferSchema),
    handler(ledgerController.createLedgerTransfer)
);

// Create a predefined ledger operation
adminLedgerRoutes.post(
    '/operations',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    validateBody(CreateLedgerOperationSchema),
    handler(ledgerController.createLedgerOperation)
);

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

// Get all operations grouped by entity type
adminLedgerRoutes.get(
    '/operations',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler(ledgerController.getAllOperations)
);

// Get operations for a specific entity type
adminLedgerRoutes.get(
    '/operations/:entityType',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler(ledgerController.getOperationsByEntityType)
);


export default adminLedgerRoutes;
