// Public API Exports for the 'banking-ledger' package

// Accounting Domain (The Primary Interface)
export { Ledger } from './core/Ledger';
export type { LedgerTransferRequest } from './api/types';
export { initLedgerModule } from './module';
export type { LedgerModule, LedgerModuleConfig } from './module';
export type { LedgerOptions, LedgerDisplayMode } from './core/Ledger';

// Engine (Low Level)
export { PostingEngine } from './engine/PostingEngine';

// Types & Enums
export { AccountType, AccountStatus } from './api/types';
export type { LedgerEntry, LedgerCommand, Money, CreateAccountInput } from './api/types';

// Errors
export {
    InsufficientFundsError,
    AccountNotFoundError,
    DoubleEntryError,
    ConcurrencyError,
    LedgerError,
    InvalidCommandError,
} from './api/errors';

// Audit
export { AuditService } from './services/AuditService';
export type { AuditLogRecord, AuditLogMode } from './services/AuditService';

// Events
export { ledgerEvents, LedgerEventType } from './engine/LedgerEvents';

// Configuration
export {
    initConnection,
    close as closeConnection,
    dbProperties,
    isInitialized,
    type LedgerPoolConfig,
} from './infra/postgres';


// Reporting
export { AccountStatement } from './reporting/AccountStatement';
export { BalanceSheet } from './reporting/BalanceSheet';
export { GeneralLedger } from './reporting/GeneralLedger';
export { TrialBalance } from './reporting/TrialBalance';

// Jobs (Cron / Maintenance)
export {
    runSnapshotJob,
    runSealLedgerJob,
    runVerifyIntegrityJob,
    runIntegrityChecksJob,
    runOptimizeDbJob,
    runResetDbJob,
    runEodRebuildJob,
} from './scheduler/jobs';
export type {
    JobOptions,
    SnapshotJobOptions,
    SealLedgerJobOptions,
    VerifyIntegrityJobOptions,
    IntegrityChecksJobOptions,
    EodRebuildJobOptions,
} from './scheduler/jobs';
