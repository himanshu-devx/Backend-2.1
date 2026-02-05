import { Ledger, LedgerOptions } from './core/Ledger';
import { initConnection, close as closeConnection, dbProperties, LedgerPoolConfig } from './infra/postgres';
import {
  runSnapshotJob,
  runSealLedgerJob,
  runVerifyIntegrityJob,
  runIntegrityChecksJob,
  runOptimizeDbJob,
  runResetDbJob,
  runEodRebuildJob,
  JobOptions,
  SnapshotJobOptions,
  SealLedgerJobOptions,
  VerifyIntegrityJobOptions,
  IntegrityChecksJobOptions,
  EodRebuildJobOptions,
} from './scheduler/jobs';
import { AuditService, AuditLogMode } from './services/AuditService';

export interface LedgerModuleConfig {
  db?: LedgerPoolConfig;
  ledger?: LedgerOptions;
  audit?: {
    mode?: AuditLogMode;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    disabledActions?: string[];
  };
}

export interface LedgerModule {
  ledger: Ledger;
  jobs: {
    snapshot: (options?: SnapshotJobOptions) => Promise<{ processed: number }>;
    seal: (options?: SealLedgerJobOptions) => Promise<void>;
    verify: (options?: VerifyIntegrityJobOptions) => Promise<{ checked: number; errors: number; ok: boolean }>;
    integrityChecks: (
      options?: IntegrityChecksJobOptions,
    ) => Promise<{ ok: boolean; checks: Array<{ name: string; count: number }> }>;
    optimize: (options?: JobOptions) => Promise<void>;
    reset: (options?: JobOptions) => Promise<void>;
    eodRebuild: (options?: EodRebuildJobOptions) => Promise<{ updated: number; snapshots: number; eodAt: Date }>;
  };
  close: () => Promise<void>;
}

/**
 * Initialize the ledger module once and reuse across your app.
 * This will create a shared PG pool and a Ledger instance bound to it.
 */
export function initLedgerModule(config: LedgerModuleConfig = {}): LedgerModule {
  if (config.db) {
    initConnection(config.db);
  }

  if (config.audit) {
    AuditService.configure({
      mode: 'sync',
      flushIntervalMs: 500,
      maxBatchSize: 100,
      disabledActions: ['TRANSFER_POSTED', 'TRANSFER_PENDING'],
      ...config.audit,
    });
  }

  const ledger = new Ledger(dbProperties.pool, config.ledger);
  return {
    ledger,
    jobs: {
      snapshot: (options) => runSnapshotJob(options),
      seal: (options) => runSealLedgerJob(options),
      verify: (options) => runVerifyIntegrityJob(options),
      integrityChecks: (options) => runIntegrityChecksJob(options),
      optimize: (options) => runOptimizeDbJob(options),
      reset: (options) => runResetDbJob(options),
      eodRebuild: (options) => runEodRebuildJob(options),
    },
    close: async () => {
      await AuditService.shutdown();
      await closeConnection();
    },
  };
}
