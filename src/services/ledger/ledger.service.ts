import {
  initLedgerModule,
  LedgerModule,
  Ledger,
  AccountType,
  AccountStatus,
  LedgerTransferRequest,
  AccountStatement,
  BalanceSheet,
  GeneralLedger,
  TrialBalance,
  runSnapshotJob,
  runSealLedgerJob,
  runVerifyIntegrityJob,
  runIntegrityChecksJob,
  runOptimizeDbJob,
  runEodRebuildJob,
  SnapshotJobOptions,
  SealLedgerJobOptions,
  VerifyIntegrityJobOptions,
  IntegrityChecksJobOptions,
  EodRebuildJobOptions,
  JobOptions,
  CreateAccountInput,
} from 'fintech-ledger';
import { LedgerUtils } from '@/utils/ledger.utils';

type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
};

export class LedgerService {
  private static module: LedgerModule | null = null;

  // =====================================================
  // INITIALIZATION
  // =====================================================

  static async init(dbConfig: DbConfig): Promise<void> {
    if (this.module) return; // idempotent

    try {
      this.module = await initLedgerModule({
        db: dbConfig,
        audit: {
          mode: 'async',
          flushIntervalMs: 500,
          maxBatchSize: 200,
        },
        ledger: {
          displayMode: 'normalized',
        },
      });
    } catch (err: any) {
      throw new Error(
        `Ledger bootstrap failed: ${err?.message ?? 'unknown error'}`
      );
    }
  }

  private static get ledger(): Ledger {
    if (!this.module) {
      throw new Error('Ledger module not initialized');
    }
    return this.module.ledger;
  }

  // =====================================================
  // ACCOUNT MANAGEMENT
  // =====================================================

  static createAccount(input: CreateAccountInput) {
    return this.ledger.createAccount(input);
  }

  static updateAccount(
    id: string,
    updates: {
      status?: AccountStatus;
      allowOverdraft?: boolean;
      minBalance?: string | number;
      type?: AccountType;
    },
    actorId = 'system'
  ) {
    return this.ledger.updateAccount(id, updates, actorId);
  }

  static getAccountById(id: string) {
    return this.ledger.getAccount(id);
  }

  static getAccountByIds(ids: string[]) {
    return this.ledger.getAccounts(ids);
  }

  static searchAccounts(pattern: string) {
    return this.ledger.searchAccounts(pattern);
  }

  static getAllAccounts() {
    return this.ledger.getAllAccounts();
  }


  // =====================================================
  // TRANSFERS / JOURNAL ENTRIES
  // =====================================================

  static transfer(request: LedgerTransferRequest) {
    return this.ledger.transfer(request);
  }

  static transferBatch(requests: LedgerTransferRequest[]) {
    return this.ledger.transferBatch(requests);
  }

  static post(entryId: string, actorId = 'system') {
    return this.ledger.post(entryId, actorId);
  }

  static postBatch(entryIds: string[], actorId = 'system') {
    return this.ledger.postBatch(entryIds, actorId);
  }

  static void(entryId: string, actorId = 'system') {
    return this.ledger.void(entryId, actorId);
  }

  static voidBatch(entryIds: string[], actorId = 'system') {
    return this.ledger.voidBatch(entryIds, actorId);
  }

  static reverse(entryId: string, actorId = 'system') {
    return this.ledger.reverse(entryId, actorId);
  }

  // =====================================================
  // BALANCES
  // =====================================================

  static getBalance(accountId: string) {
    return this.ledger.getBalance(accountId);
  }

  static getBalances(accountId: string) {
    return this.ledger.getBalances(accountId);
  }

  // =====================================================
  // LEDGER QUERIES
  // =====================================================

  static getEntries(accountId: string, options: any = {}) {
    return this.ledger.getEntries(accountId, options);
  }

  static getEntry(entryId: string) {
    return this.ledger.getEntry(entryId);
  }

  // =====================================================
  // REPORTS (READ-ONLY)
  // =====================================================

  static getAccountStatement(accountId: string, limit = 100) {
    return new AccountStatement().getStatement(accountId, limit);
  }

  static getBalanceSheet() {
    return new BalanceSheet().generate();
  }

  static getGeneralLedger(
    accountId: string,
    fromDate: Date,
    toDate: Date
  ) {
    return new GeneralLedger().getReport(accountId, fromDate, toDate);
  }

  static getTrialBalance() {
    return new TrialBalance().getReport();
  }

  // =====================================================
  // MAINTENANCE / JOBS
  // =====================================================

  static runSnapshotJob(options: SnapshotJobOptions = {}) {
    return runSnapshotJob(options);
  }

  static runSealLedgerJob(options: SealLedgerJobOptions = {}) {
    return runSealLedgerJob(options);
  }

  static runVerifyIntegrityJob(options: VerifyIntegrityJobOptions = {}) {
    return runVerifyIntegrityJob(options);
  }

  static runIntegrityChecksJob(options: IntegrityChecksJobOptions = {}) {
    return runIntegrityChecksJob(options);
  }

  static runOptimizeDbJob(options: JobOptions = {}) {
    return runOptimizeDbJob(options);
  }

  static runEodRebuildJob(options: EodRebuildJobOptions = {}) {
    return runEodRebuildJob(options);
  }
}
