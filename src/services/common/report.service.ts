import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GeneratedReportModel, ReportStatus, ReportType, GeneratedReportDocument } from "@/models/generated-report.model";
import { TransactionService } from "@/services/transaction.service";
import { LedgerEntryService } from "@/services/ledger/ledger-entry.service";
import { EmailService } from "@/services/email.service";
import { getISTDate, getShiftedISTDate } from "@/utils/date.util";
import { ENV } from "@/config/env";
import { Logger } from "pino";
import { emailTemplates, EmailTemplate } from "@/infra/email/templates";

export interface ReportRequest {
    type: ReportType;
    ownerId: string;
    ownerType: "MERCHANT" | "ADMIN";
    ownerEmail: string;
    filters: any;
}

export class ReportService {
    private static DEFAULT_STORAGE_DIR = path.join(process.cwd(), "storage", "reports");
    private static MAX_REPORT_RECORDS = 50000; // Optimal boundary for stability
    private static emailService: EmailService;

    static setEmailService(service: EmailService) {
        this.emailService = service;
    }

    static async requestReport(req: ReportRequest): Promise<GeneratedReportDocument> {
        const report = await GeneratedReportModel.create({
            ...req,
            status: ReportStatus.PENDING,
        });
        this.processInBackground(report.id);
        return report;
    }

    static async listReports(ownerId: string, ownerType: "MERCHANT" | "ADMIN") {
        return GeneratedReportModel.find({ ownerId, ownerType }).sort({ createdAt: -1 });
    }

    static async getReportById(id: string, ownerId: string) {
        return GeneratedReportModel.findOne({ id, ownerId });
    }

    private static async processInBackground(reportId: string) {
        this.runGeneration(reportId).catch(err => {
            console.error(`Report generation failed for ${reportId}:`, err);
        });
    }

    private static async runGeneration(reportId: string) {
        const report = await GeneratedReportModel.findOne({ id: reportId });
        if (!report) return;

        try {
            await GeneratedReportModel.updateOne({ id: reportId }, { status: ReportStatus.PROCESSING });

            let csvContent = "";
            const filters = report.filters || {};

            if (report.type === ReportType.TRANSACTIONS) {
                // Highly Optimized Fetching: Projection + Proper Limit
                const result = await TransactionService.list({
                    ...filters,
                    limit: this.MAX_REPORT_RECORDS,
                    fields: "id,createdAt,amount,currency,type,status,orderId,utr"
                } as any);

                if (result.ok) {
                    const headers = ["id", "createdAt", "amount", "currency", "type", "status", "orderId", "utr"];
                    csvContent = this.convertToCsv(result.value.data, headers);
                }
            } else if (report.type === ReportType.LEDGER_STATEMENT) {
                const result = await LedgerEntryService.getAccountStatement(filters.accountId, {
                    startDate: filters.startDate,
                    endDate: filters.endDate,
                    limit: this.MAX_REPORT_RECORDS,
                });
                csvContent = this.convertToBankingCsv(result, filters.accountId);

                await GeneratedReportModel.updateOne({ id: reportId }, {
                    metadata: {
                        openingBalance: result.openingBalance,
                        closingBalance: result.closingBalance,
                        debitTotal: result.debitTotal,
                        creditTotal: result.creditTotal
                    }
                });
            }

            const filename = `${report.id}_${Date.now()}.csv`;
            const storageDir = this.resolveStorageDir();
            const filePath = path.join(storageDir, filename);

            fs.writeFileSync(filePath, csvContent);
            const stats = fs.statSync(filePath);

            await GeneratedReportModel.updateOne({ id: reportId }, {
                status: ReportStatus.COMPLETED,
                filename,
                filePath,
                fileSize: stats.size,
                processedAt: getISTDate(),
            });

            // Notify via email - Check ENV flags
            const shouldSendTransactionEmail = report.type === ReportType.TRANSACTIONS && ENV.REPORT_EMAIL_TRANSACTIONS_ENABLED;
            const shouldSendStatementEmail = report.type === ReportType.LEDGER_STATEMENT && ENV.REPORT_EMAIL_STATEMENT_ENABLED;

            if (shouldSendTransactionEmail || shouldSendStatementEmail) {
                await this.notifyRecipient(reportId);
            }

        } catch (error: any) {
            await GeneratedReportModel.updateOne({ id: reportId }, {
                status: ReportStatus.FAILED,
                error: error.message,
            });
        }
    }

    private static resolveStorageDir(): string {
        const configured = ENV.REPORT_STORAGE_DIR?.trim();
        const primary = configured && configured.length
            ? configured
            : this.DEFAULT_STORAGE_DIR;

        try {
            if (!fs.existsSync(primary)) {
                fs.mkdirSync(primary, { recursive: true });
            }
            fs.accessSync(primary, fs.constants.W_OK);
            return primary;
        } catch (err: any) {
            if (err?.code !== "EACCES" && err?.code !== "EROFS") {
                throw err;
            }
            const fallback = path.join(os.tmpdir(), "wisipay", "reports");
            if (!fs.existsSync(fallback)) {
                fs.mkdirSync(fallback, { recursive: true });
            }
            return fallback;
        }
    }

    private static convertToBankingCsv(result: any, accountId: string): string {
        const { period, openingBalance, closingBalance, debitTotal, creditTotal, currency, lines } = result;
        const startStr = period.start.toISOString().split('T')[0];
        const endStr = period.end.toISOString().split('T')[0];
        const generatedAt = getISTDate().toISOString().replace('T', ' ').split('.')[0];

        const sections = [
            `"--- ${ENV.APP_BRAND_NAME.toUpperCase()} - OFFICIAL ACCOUNT STATEMENT ---"`,
            `"ACCOUNT ID:","${accountId}"`,
            `"STATEMENT PERIOD:","${startStr} to ${endStr}"`,
            `"GENERATED AT:","${generatedAt} (IST)"`,
            `"CURRENCY:","${currency}"`,
            `""`,
            `"=== PERIOD SUMMARY ==="`,
            `"Opening Balance:","${openingBalance}"`,
            `"Total Debits:","${debitTotal}"`,
            `"Total Credits:","${creditTotal}"`,
            `"Closing Balance:","${closingBalance}"`,
            `""`,
            `"--------------------------------------------------------------------------------"`,
            `"DATE","NARRATION","TRANSACTION ID","DEBIT","CREDIT","RUNNING BALANCE"`
        ];

        const dataRows = lines.map((line: any) => {
            const dateStr = line.date.toISOString().replace('T', ' ').split('.')[0];
            return `"${dateStr}","${line.description}","${line.entryId}","${line.debit}","${line.credit}","${line.runningBalance}"`;
        });

        const footer = [
            `"--------------------------------------------------------------------------------"`,
            `""`,
            `"NOTE: This is a computer-generated statement and does not require a physical signature."`,
            `"AUTHORIZED BY: ${ENV.APP_BRAND_NAME.toUpperCase()} TEAM"`
        ];

        return [...sections, ...dataRows, ...footer].join("\n");
    }

    private static convertToCsv(data: any[], headers: string[]): string {
        const headerRow = headers.join(",");
        const rows = data.map(item => {
            return headers.map(header => {
                let val = item[header];
                if (val === null || val === undefined) return "";

                // Format dates as ISO strings (now already shifted to IST by services)
                if (val instanceof Date) {
                    val = val.toISOString().replace('T', ' ').split('.')[0];
                } else if (typeof val === 'string' && (header === 'createdAt' || header === 'date' || header === 'postedAt')) {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                        val = d.toISOString().replace('T', ' ').split('.')[0];
                    }
                }

                if (header === "status") {
                    const s = String(val).toUpperCase();
                    if (s === "SUCCESS" || s === "COMPLETED") val = "SUCCESS";
                    else if (s === "FAILED" || s === "ERROR") val = "FAILED";
                    else if (s === "PENDING" || s === "PROCESSING") val = "PENDING";
                    else val = s;
                }

                if (typeof val === "object") val = JSON.stringify(val);
                // Escape commas and quotes for CSV
                const escaped = String(val).replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(",");
        });
        return [headerRow, ...rows].join("\n");
    }

    private static async notifyRecipient(reportId: string) {
        const report = await GeneratedReportModel.findOne({ id: reportId });
        if (!report || !this.emailService) return;

        try {
            const context: any = {
                reportId: report.id,
                reportType: report.type,
                ownerName: report.ownerId, // Default to ownerId if name not available
            };

            if (report.metadata?.openingBalance) {
                context.summary = {
                    openingBalance: report.metadata.openingBalance,
                    closingBalance: report.metadata.closingBalance,
                    debitTotal: report.metadata.debitTotal,
                    creditTotal: report.metadata.creditTotal,
                };
            }

            const { subject, html } = emailTemplates.REPORT_READY(context);

            await this.emailService.sendRaw({
                to: report.ownerEmail,
                subject: subject,
                html: html
            });
        } catch (err) {
            console.error("Failed to send report email:", err);
        }
    }
}
