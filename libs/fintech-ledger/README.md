# Fintech Ledger

Production‑style double‑entry ledger module with strict balances, pending/posting workflow, and cryptographic integrity sealing. Built to be embedded inside your own systems.

## Install

```bash
npm install fintech-ledger
```

## Quick Start (Module)

```ts
import { initLedgerModule } from 'fintech-ledger';

const ledgerModule = initLedgerModule({
  db: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'ledger',
    timezone: 'Asia/Kolkata', // optional
  },
  audit: {
    mode: 'async',
    flushIntervalMs: 500,
    maxBatchSize: 100,
    // Disable transfer audit logs if you want maximum throughput
    // disabledActions: ['TRANSFER_POSTED', 'TRANSFER_PENDING'],
  },
});

await ledgerModule.ledger.createAccount('acc-cash', 'CASH', 'ASSET');
await ledgerModule.ledger.createAccount('acc-income', 'INCOME', 'INCOME');

const entryId = await ledgerModule.ledger.transfer({
  narration: 'Cash sale',
  debits: [{ accountId: 'acc-cash', amount: '100.00' }],
  credits: [{ accountId: 'acc-income', amount: '100.00' }],
  status: 'POSTED',
});

const balances = await ledgerModule.ledger.getBalances('acc-cash');
console.log(balances); // { ledger: "100.00", pending: "0.00" }

await ledgerModule.close();
```

## Quick Start (Manual Init)

```ts
import { initConnection, Ledger } from 'fintech-ledger';

initConnection({
  host: 'localhost',
  user: 'postgres',
  password: 'postgres',
  database: 'ledger',
});

const ledger = new Ledger();
```

## Core Operations

```ts
import { Ledger } from 'fintech-ledger';

const ledger = new Ledger();

await ledger.createAccount('acc-1', 'CASH', 'ASSET');
await ledger.createAccount('acc-2', 'BANK', 'ASSET', false, undefined, false);

const entryId = await ledger.transfer({
  narration: 'Transfer',
  debits: [{ accountId: 'acc-1', amount: '10.00' }],
  credits: [{ accountId: 'acc-2', amount: '10.00' }],
  status: 'PENDING',
  idempotencyKey: 'txn-123',
});

await ledger.post(entryId);
await ledger.reverse(entryId);
await ledger.void(entryId);
```

## Cron / Jobs

The ledger exposes cron‑friendly job functions. You can run these from `cron`, `node-cron`, or any scheduler.

```ts
import {
  runSnapshotJob,
  runSealLedgerJob,
  runVerifyIntegrityJob,
  runOptimizeDbJob,
  runEodRebuildJob,
} from 'fintech-ledger';

await runSnapshotJob({
  init: {
    host: 'localhost',
    user: 'postgres',
    password: 'postgres',
    database: 'ledger',
  },
  autoClose: true,
  batchSize: 100,
});

await runSealLedgerJob({ autoClose: true, batchSize: 100 });
await runVerifyIntegrityJob({ autoClose: true });
await runOptimizeDbJob({ autoClose: true });
await runEodRebuildJob({ autoClose: true });
```

### System Cron Example

```cron
# Run snapshots at 1am daily
0 1 * * * /usr/bin/node /path/to/app/dist/jobs/snapshot.js

# Seal ledger every 5 minutes
*/5 * * * * /usr/bin/node /path/to/app/dist/jobs/seal.js

# EOD rebuild at 11:59pm daily
59 23 * * * /usr/bin/node /path/to/app/dist/jobs/eod_rebuild.js
```

### Node‑Cron Example

```ts
import cron from 'node-cron';
import { runSnapshotJob, runSealLedgerJob } from 'fintech-ledger';

cron.schedule('0 1 * * *', async () => {
  await runSnapshotJob({ autoClose: true });
});

cron.schedule('*/5 * * * *', async () => {
  await runSealLedgerJob({ autoClose: true });
});
```

## Environment Variables

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_TIMEZONE` (default `Asia/Kolkata`)

## Notes

- All amounts are stored as `BIGINT` in the smallest currency unit (e.g., paisa).
- Double‑entry rules are enforced on every post.
- Pending entries reserve balances until posted or voided.
- Hash chain sealing provides tamper‑evidence.
