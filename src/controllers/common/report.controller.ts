import { Context } from 'hono';
import { ReportService } from '@/services/common/report.service';
import { ReportType } from '@/models/generated-report.model';
import fs from 'node:fs';
import path from 'node:path';

export const requestTransactionReport = async (c: Context, ownerType: 'MERCHANT' | 'ADMIN') => {
    try {
        const ownerId = c.get('id');
        const user = c.get('user'); // Assuming user object is in context
        const filters = c.req.query();

        // Ensure merchant can only report their own transactions
        if (ownerType === 'MERCHANT') {
            filters.merchantId = ownerId;
        }

        const report = await ReportService.requestReport({
            type: ReportType.TRANSACTIONS,
            ownerId,
            ownerType,
            ownerEmail: user?.email || 'noreply@example.com', // Fallback if email not in context
            filters
        });

        return c.json({ success: true, message: 'Report generation started in background', data: { reportId: report.id } });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to request report', error: error.message }, 500);
    }
};

export const requestStatementReport = async (c: Context, ownerType: 'MERCHANT' | 'ADMIN') => {
    try {
        const ownerId = c.get('id');
        const user = c.get('user');
        const accountId = c.req.param('accountId');
        const { startDate, endDate } = c.req.query();

        const report = await ReportService.requestReport({
            type: ReportType.LEDGER_STATEMENT,
            ownerId,
            ownerType,
            ownerEmail: user?.email || 'noreply@example.com',
            filters: { accountId, startDate, endDate }
        });

        return c.json({ success: true, message: 'Statement generation started in background', data: { reportId: report.id } });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to request statement report', error: error.message }, 500);
    }
};

export const listMyReports = async (c: Context, ownerType: 'MERCHANT' | 'ADMIN') => {
    try {
        const ownerId = c.get('id');
        const reports = await ReportService.listReports(ownerId, ownerType);
        return c.json({ success: true, data: reports });
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to list reports', error: error.message }, 500);
    }
};

export const downloadReport = async (c: Context) => {
    try {
        const ownerId = c.get('id');
        const reportId = c.req.param('reportId');

        const report = await ReportService.getReportById(reportId, ownerId);
        if (!report || !report.filePath) {
            return c.json({ success: false, message: 'Report not found or not ready' }, 404);
        }

        if (!fs.existsSync(report.filePath)) {
            return c.json({ success: false, message: 'Report file missing' }, 410);
        }

        const stats = fs.statSync(report.filePath);
        const fileName = report.filename || `report_${reportId}.csv`;

        // Stream the file
        const stream = fs.createReadStream(report.filePath);

        c.header('Content-Type', 'text/csv');
        c.header('Content-Disposition', `attachment; filename="${fileName}"`);
        c.header('Content-Length', stats.size.toString());

        return c.body(stream as any);
    } catch (error: any) {
        return c.json({ success: false, message: 'Failed to download report', error: error.message }, 500);
    }
};
