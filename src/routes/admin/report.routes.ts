import { Hono } from 'hono';
import { authorizeRoles } from '@/middlewares/auth.middleware';
import { handler } from '@/utils/handler';
import * as reportController from '@/controllers/common/report.controller';
import { ADMIN_ROLES } from '@/constants/users.constant';

const adminReportRoutes = new Hono();

// Transaction Report
adminReportRoutes.post(
    '/transactions',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler((c) => reportController.requestTransactionReport(c, 'ADMIN'))
);

// Account Statement Report
adminReportRoutes.post(
    '/accounts/:accountId/statement',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler((c) => reportController.requestStatementReport(c, 'ADMIN'))
);

// List All My Reports
adminReportRoutes.get(
    '/',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler((c) => reportController.listMyReports(c, 'ADMIN'))
);

// Download Report
adminReportRoutes.get(
    '/:reportId/download',
    authorizeRoles([ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN]),
    handler(reportController.downloadReport)
);

export default adminReportRoutes;
