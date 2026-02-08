import { LedgerService } from './ledger.service';
import { merchantRepository } from '@/repositories/merchant.repository';
import { AccountStatement, TrialBalance, BalanceSheet, GeneralLedger } from 'fintech-ledger';
import { getShiftedISTDate } from '@/utils/date.util';
import { toDisplayAmountFromLedger } from '@/utils/money.util';

const toRupeesFromLedger = (rawVal: any): number => toDisplayAmountFromLedger(rawVal);
const formatRupees = (rawVal: any) => `₹ ${toDisplayAmountFromLedger(rawVal).toFixed(2)}`;

export interface GetEntriesOptions {
    // Pagination
    page?: number;
    limit?: number;

    // Filters
    status?: 'POSTED' | 'PENDING' | 'VOIDED';
    type?: 'DEBIT' | 'CREDIT';

    // Date range
    startDate?: string; // ISO date string
    endDate?: string;   // ISO date string

    // Amount range
    minAmount?: number;
    maxAmount?: number;

    // Search
    description?: string; // Search in description

    // Sorting
    sortBy?: 'createdAt' | 'postedAt' | 'amount';
    sortOrder?: 'asc' | 'desc';
}

export interface PaginatedEntriesResponse {
    entries: any[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
    filters: Partial<GetEntriesOptions & { accountId: string }>;
}

export class LedgerEntryService {
    /**
     * ACCOUNT-LEVEL REPORTS (Merchant & Admin)
     * These reports are specific to a single account.
     */

    /**
     * Get Ledger Entries: A raw, filterable, and paginated chronological list of postings.
     * Best for: Transaction history search and operational tracking.
     */
    /**
     * ACCOUNT-LEVEL REPORTS (Merchant & Admin)
     */

    /**
     * 1. Get Ledger Entries: Optimized for Transaction History UI.
     * Features: Filtering, Pagination, Related Leg info.
     */
    static async getEntriesByAccountId(
        accountId: string,
        options: GetEntriesOptions = {}
    ): Promise<PaginatedEntriesResponse> {
        const {
            page = 1,
            limit = 20,
            status,
            type,
            startDate,
            endDate,
            minAmount,
            maxAmount,
            description,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = options;

        const validatedLimit = Math.min(Math.max(1, limit), 100);
        const validatedPage = Math.max(1, page);

        const fetchLimit = validatedLimit * validatedPage + 100;
        const allEntries = await LedgerService.getEntries(accountId, { limit: fetchLimit });

        let filteredEntries = allEntries;

        if (status) filteredEntries = filteredEntries.filter((entry: any) => entry.status === status);
        if (startDate) {
            const start = new Date(startDate);
            filteredEntries = filteredEntries.filter((entry: any) => new Date(entry.postedAt || entry.createdAt) >= start);
        }
        if (endDate) {
            const end = new Date(endDate);
            filteredEntries = filteredEntries.filter((entry: any) => new Date(entry.postedAt || entry.createdAt) <= end);
        }
        if (description) {
            const searchTerm = description.toLowerCase();
            filteredEntries = filteredEntries.filter((entry: any) => entry.description?.toLowerCase().includes(searchTerm));
        }

        if (type) {
            filteredEntries = filteredEntries.filter((entry: any) => {
                const line = entry.lines?.find((l: any) => l.accountId === accountId);
                if (!line) return false;
                const amt = Number(line.amount);
                if (Number.isNaN(amt)) return false;
                return type === 'DEBIT' ? amt > 0 : amt < 0;
            });
        }

        if (minAmount !== undefined || maxAmount !== undefined) {
            filteredEntries = filteredEntries.filter((entry: any) => {
                const line = entry.lines?.find((l: any) => l.accountId === accountId);
                if (!line) return false;
                const amount = Math.abs(toRupeesFromLedger(line.amount));
                if (minAmount !== undefined && amount < minAmount) return false;
                if (maxAmount !== undefined && amount > maxAmount) return false;
                return true;
            });
        }

        filteredEntries.sort((a: any, b: any) => {
            let aValue: any;
            let bValue: any;
            if (sortBy === 'amount') {
                const aLine = a.lines?.find((l: any) => l.accountId === accountId);
                const bLine = b.lines?.find((l: any) => l.accountId === accountId);
                aValue = aLine ? Math.abs(toRupeesFromLedger(aLine.amount)) : 0;
                bValue = bLine ? Math.abs(toRupeesFromLedger(bLine.amount)) : 0;
            } else if (sortBy === 'postedAt') {
                aValue = new Date(a.postedAt || a.createdAt).getTime();
                bValue = new Date(b.postedAt || b.createdAt).getTime();
            } else {
                aValue = new Date(a.createdAt).getTime();
                bValue = new Date(b.createdAt).getTime();
            }
            return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
        });

        const total = filteredEntries.length;
        const totalPages = Math.ceil(total / validatedLimit);
        const startIndex = (validatedPage - 1) * validatedLimit;
        const paginatedEntries = filteredEntries.slice(startIndex, startIndex + validatedLimit);

        const formattedEntries = paginatedEntries.map((entry: any) => {
            const line = entry.lines?.find((l: any) => l.accountId === accountId);
            const rawVal = line?.amount || '0';
            const amountValue = toRupeesFromLedger(rawVal);

            return {
                id: entry.id,
                postedAt: getShiftedISTDate(entry.postedAt || entry.createdAt),
                amount: `₹ ${Math.abs(amountValue).toFixed(2)}`,
                currency: 'INR',
                type: amountValue > 0 ? 'DEBIT' : 'CREDIT',
                status: entry.status,
                description: entry.description || '',
                metadata: entry.metadata || {},
                relatedEntries: entry.lines
                    ?.filter((l: any) => l.accountId !== accountId)
                    .map((l: any) => {
                        const rVal = l.amount || '0';
                        const rAmt = toRupeesFromLedger(rVal);
                        return {
                            accountId: l.accountId,
                            amount: `₹ ${Math.abs(rAmt).toFixed(2)}`,
                            currency: 'INR',
                            type: rAmt > 0 ? 'DEBIT' : 'CREDIT',
                        };
                    }) || [],
            };
        });

        return {
            entries: formattedEntries,
            pagination: {
                page: validatedPage,
                limit: validatedLimit,
                total,
                totalPages,
            },
            filters: { accountId, status, type, startDate, endDate, minAmount, maxAmount, description }
        };
    }

    /**
     * 2. Get Account Statement: Optimized for Reconciliation.
     * Features: Opening Balance, Running Balances, Closing Balance.
     */
    static async getAccountStatement(accountId: string, options: { startDate?: string; endDate?: string; limit?: number } = {}) {
        const { getTodayRangeIST, parseDateRangeToIST } = await import('@/utils/date.util');
        const limit = options.limit || 100;

        let start: Date;
        let end: Date;

        if (options.startDate && options.endDate) {
            const range = parseDateRangeToIST(options.startDate, options.endDate);
            start = range.startDate;
            end = range.endDate;
        } else {
            const range = getTodayRangeIST();
            start = range.start;
            end = range.end;
        }

        // Fetch lines for statement
        const statementLines = await new AccountStatement().getStatement(accountId, limit);

        // Use GeneralLedger to get accurate opening balance for the period
        const glReport = await new GeneralLedger().getReport(accountId, start, end);

        const formattedLines = statementLines.map((line: any) => {
            // Use normalized amount for debit/credit classification
            // Normalized: Positive = Balance increases (Income/Liability), Negative = Balance decreases
            // However, traditionally: Debit (left), Credit (right)
            // For a merchant account (Liability):
            // CREDIT increases balance (Inflow), DEBIT decreases balance (Outflow)
            const amt = toRupeesFromLedger(line.rawAmount);
            return {
                date: getShiftedISTDate(line.date),
                description: line.description,
                debit: amt > 0 ? `₹ ${Math.abs(amt).toFixed(2)}` : '₹ 0.00',
                credit: amt < 0 ? `₹ ${Math.abs(amt).toFixed(2)}` : '₹ 0.00',
                runningBalance: formatRupees(line.balanceAfter),
                currency: 'INR',
                entryId: line.entryId
            };
        });

        return {
            period: { start: getShiftedISTDate(start), end: getShiftedISTDate(end) },
            openingBalance: formatRupees(glReport.openingBalance),
            debitTotal: `₹ ${Math.abs(toRupeesFromLedger(glReport.debitTotal)).toFixed(2)}`,
            creditTotal: `₹ ${Math.abs(toRupeesFromLedger(glReport.creditTotal)).toFixed(2)}`,
            closingBalance: formatRupees(glReport.closingBalance),
            currency: 'INR',
            lines: formattedLines
        };
    }

    /**
     * 3. Get General Ledger (Account): Optimized for Period Audit.
     * Features: Period Summary (Aggregates).
     */
    static async getGeneralLedger(accountId: string, startDate?: string, endDate?: string) {
        const { getTodayRangeIST, parseDateRangeToIST } = await import('@/utils/date.util');
        let start: Date;
        let end: Date;

        if (startDate && endDate) {
            const range = parseDateRangeToIST(startDate, endDate);
            start = range.startDate;
            end = range.endDate;
        } else {
            const range = getTodayRangeIST();
            start = range.start;
            end = range.end;
        }

        const report = await new GeneralLedger().getReport(accountId, start, end);

        return {
            period: { start: getShiftedISTDate(start), end: getShiftedISTDate(end) },
            summary: {
                openingBalance: formatRupees(report.openingBalance),
                debitTotal: formatRupees(report.debitTotal),
                creditTotal: formatRupees(report.creditTotal),
                netChange: formatRupees(Number(report.closingBalance) - Number(report.openingBalance)),
                closingBalance: formatRupees(report.closingBalance),
                currency: 'INR',
                normalBalanceSide: report.normalBalanceSide
            }
        };
    }

    /**
     * View Entry details by ID.
     */
    static async getEntryById(entryId: string): Promise<any> {
        const entry = await LedgerService.getEntry(entryId);
        if (!entry) return null;

        return {
            id: entry.id,
            description: entry.description || '',
            status: entry.status,
            metadata: entry.metadata || {},
            createdAt: entry.createdAt,
            postedAt: entry.postedAt,
            voidedAt: entry.voidedAt || null,
            actorId: entry.actorId || 'system',
            lines: entry.lines?.map((l: any) => ({
                accountId: l.accountId,
                amount: Math.abs(toRupeesFromLedger(l.amount)).toFixed(2),
                type: Number(l.amount) > 0 ? 'DEBIT' : 'CREDIT',
            })) || [],
        };
    }

    /**
     * Security: Verify that a merchant owns a specific account.
     */
    static async verifyMerchantOwnership(
        merchantId: string,
        accountId: string
    ): Promise<boolean> {
        const expectedPart = `:MERCHANT:${merchantId}:`;
        if (!accountId.includes(expectedPart)) return false;

        const merchant = await merchantRepository.findById(merchantId);
        if (!merchant) return false;

        const merchantObj = (merchant as any).toObject ? (merchant as any).toObject() : merchant;
        const merchantAccounts = merchantObj.accounts || {};
        const accountIds = Object.values(merchantAccounts).map((v: any) => v?.toString()).filter(Boolean);
        return accountIds.includes(accountId);
    }

    /**
     * SYSTEM-LEVEL REPORTS (Admin Only)
     */
    static async getTrialBalance() {
        const report = await new TrialBalance().getReport();
        return this.formatBigInts(report);
    }

    static async getBalanceSheet() {
        const report = await new BalanceSheet().generate();
        return this.formatBigInts(report);
    }

    private static formatBigInts(obj: any): any {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'bigint') return `₹ ${toRupeesFromLedger(obj).toFixed(2)}`;
        if (Array.isArray(obj)) return obj.map(v => this.formatBigInts(v));
        if (typeof obj === 'object') {
            const newObj: any = {};
            for (const key in obj) {
                newObj[key] = this.formatBigInts(obj[key]);
            }
            return newObj;
        }
        return obj;
    }
}
