# Release Notes

## Highlights
- Modular ledger initialization with `initLedgerModule`
- Cron-ready jobs for snapshots, sealing, integrity checks, EOD rebuild
- High-throughput optimizations (prepared statements, batch APIs, pool tuning)
- Banking-style normalized balances for reporting and API responses
- Auditing improvements with async batching and per-action disable

## Added
- `initLedgerModule` with centralized DB + audit config
- Batch APIs: `transferBatch`, `postBatch`, `voidBatch`
- Integrity checks job: `runIntegrityChecksJob`
- EOD rebuild job: `runEodRebuildJob`
- Audit log viewer helpers
- Prepared statements for reporting queries
- Environment-based pool defaults and session tuning

## Changed
- Ledger display defaults to normalized (banking style)
- Audit logging now supports async batching and disabled actions
- Posting pipeline optimized (status set at insert for posted entries)

## Fixed
- Pending overspend enforcement
- `balance_after` traceability for pending-to-posted transitions
- `Money.toPaisa` negative handling and bigint input
- Audit logging serialization of bigint payloads

