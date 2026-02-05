import { Hono } from 'hono';
import { authorizeRoles } from '@/middlewares/auth.middleware';
import { handler } from '@/utils/handler';
import * as reportController from '@/controllers/common/report.controller';
import { MERCHANT_ROLES } from '@/constants/users.constant';

const merchantReportRoutes = new Hono();

// Transaction Report
merchantReportRoutes.post(
    '/transactions',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler((c) => reportController.requestTransactionReport(c, 'MERCHANT'))
);

// Account Statement Report
merchantReportRoutes.post(
    '/accounts/:accountId/statement',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler((c) => reportController.requestStatementReport(c, 'MERCHANT'))
);

// List All My Reports
merchantReportRoutes.get(
    '/',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler((c) => reportController.listMyReports(c, 'MERCHANT'))
);

// Download Report
merchantReportRoutes.get(
    '/:reportId/download',
    authorizeRoles([MERCHANT_ROLES.MERCHANT]),
    handler(reportController.downloadReport)
);

export default merchantReportRoutes;
