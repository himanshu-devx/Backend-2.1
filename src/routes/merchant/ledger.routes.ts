import { Hono } from 'hono';
import { authorizeRoles } from '@/middlewares/auth.middleware';
import { handler } from '@/utils/handler';
import * as ledgerController from '@/controllers/merchant/ledger.controller';
import { MERCHANT_ROLES } from '@/constants/users.constant';

const merchantLedgerRoutes = new Hono();

// Get entries for a specific account
merchantLedgerRoutes.get(
    '/accounts/:accountId/entries',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler(ledgerController.getMyLedgerEntries)
);

// Get Account Statement
merchantLedgerRoutes.get(
    '/accounts/:accountId/statement',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler(ledgerController.getMyAccountStatement)
);

// Get General Ledger
merchantLedgerRoutes.get(
    '/accounts/:accountId/general-ledger',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler(ledgerController.getMyGeneralLedger)
);

// Get a specific entry by ID
merchantLedgerRoutes.get(
    '/entries/:entryId',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler(ledgerController.getMyLedgerEntry)
);

export default merchantLedgerRoutes;
