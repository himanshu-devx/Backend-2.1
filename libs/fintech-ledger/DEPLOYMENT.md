# Deployment Guide

## Overview
This ledger is designed as a module that can be embedded in your systems. Use `initLedgerModule` to configure DB connections and auditing once, and then reuse `ledger` and `jobs`.

## Requirements
- Node.js 18+
- PostgreSQL 14+ (tested on 15/16)

## Install
```bash
npm install fintech-ledger
```

## Database Setup
Apply schema:
```sql
-- From src/db/schema.sql
```

Ensure indexes for audit logs exist:
```sql
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_target_id ON audit_logs(target_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
```

## Production Init
```ts
import { initLedgerModule } from 'fintech-ledger';

const ledgerModule = initLedgerModule({
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  audit: {
    mode: 'async',
    flushIntervalMs: 500,
    maxBatchSize: 100,
    disabledActions: ['TRANSFER_POSTED', 'TRANSFER_PENDING'],
  },
});
```

## Private Package (GitHub Packages)

### 1. Update `package.json`
Ensure scope and registry:
```json
{
  "name": "@your-org/fintech-ledger",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

### 2. Create `.npmrc` (project or user)
```
@your-org:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### 3. Publish
```bash
npm login --registry=https://npm.pkg.github.com
npm publish
```

### 4. Install in Consumers
```
@your-org:registry=https://npm.pkg.github.com
```
```bash
npm install @your-org/fintech-ledger
```

### 5. CI/CD
Set `GITHUB_TOKEN` in CI and ensure `.npmrc` is available during install.

## Environment Variables
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `DB_TIMEZONE` (default `Asia/Kolkata`)
- `DB_STATEMENT_TIMEOUT_MS`
- `DB_LOCK_TIMEOUT_MS`
- `DB_IDLE_IN_TX_TIMEOUT_MS`

## Cron Jobs
Recommended:
- `runSnapshotJob` nightly
- `runSealLedgerJob` every 5 minutes
- `runVerifyIntegrityJob` nightly
- `runIntegrityChecksJob` nightly
- `runEodRebuildJob` nightly

## Operational Checklist
1. Schema applied
2. DB credentials set
3. `initLedgerModule` wired once
4. Cron configured
5. Logging configuration set (async recommended)
6. Monitoring/alerts configured
