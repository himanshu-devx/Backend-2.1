# Useable Guide (Full Detail)

This is the complete, detailed usage guide with checkpoints, inputs/outputs, and operational flows.

## 1. Initialization

### 1.1. Module Init (Recommended)
```ts
import { initLedgerModule } from 'fintech-ledger';

const mod = initLedgerModule({
  db: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'ledger',
    timezone: 'Asia/Kolkata',
  },
  ledger: {
    displayMode: 'normalized', // or 'raw'
  },
  audit: {
    mode: 'async', // 'sync' | 'async' | 'disabled'
    flushIntervalMs: 500,
    maxBatchSize: 100,
    // transfers are disabled by default
    // disabledActions: ['TRANSFER_POSTED', 'TRANSFER_PENDING'],
  },
});
```

### 1.2. Manual Init
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

## 2. Accounts

### 2.1. Create Account
**Input**
```ts
await ledger.createAccount(
  'acc-cash',
  'CASH',
  'ASSET',
  false,       // allowOverdraft
  undefined,   // parentId
  false,       // isHeader
  'ACTIVE',    // status
  '0.00',      // minBalance
  'system'     // actorId
);
```

**Output**
No return value. Creates or updates the account.

**Checkpoints**
- Account exists in `accounts` table
- `ledger_balance` and `pending_balance` initialized
- Audit log created (CREATE_ACCOUNT)

### 2.2. Get Account
**Input**
```ts
const account = await ledger.getAccount('acc-cash');
```

**Output**
```json
{
  "id": "acc-cash",
  "code": "CASH",
  "type": "ASSET",
  "status": "ACTIVE",
  "ledgerBalance": "100.00",
  "pendingBalance": "0.00",
  "rawLedgerBalance": "100.00",
  "rawPendingBalance": "0.00",
  "normalBalanceSide": "DEBIT"
}
```

## 3. Transfers

### 3.1. Posted Transfer
**Input**
```ts
const entryId = await ledger.transfer({
  narration: 'Cash sale',
  debits: [{ accountId: 'acc-cash', amount: '100.00' }],
  credits: [{ accountId: 'acc-income', amount: '100.00' }],
  status: 'POSTED',
  actorId: 'user-1'
});
```

**Output**
```ts
entryId: string
```

**Checkpoints**
- `journal_entries` created with status POSTED
- `journal_lines` created and sum to 0
- `accounts.ledger_balance` updated

### 3.2. Pending Transfer
```ts
const entryId = await ledger.transfer({
  narration: 'Card auth',
  debits: [{ accountId: 'acc-cash', amount: '50.00' }],
  credits: [{ accountId: 'acc-clearing', amount: '50.00' }],
  status: 'PENDING',
});
```

**Checkpoints**
- `pending_balance` updated
- `ledger_balance` unchanged

### 3.3. Post Pending
```ts
await ledger.post(entryId);
```

### 3.4. Void Pending
```ts
await ledger.void(entryId);
```

### 3.5. Reverse Posted
```ts
const reversalId = await ledger.reverse(entryId);
```

## 4. Batch APIs

### 4.1. Batch Transfer
```ts
const ids = await ledger.transferBatch([
  {
    narration: 'Batch A',
    debits: [{ accountId: 'acc-a', amount: '10.00' }],
    credits: [{ accountId: 'acc-b', amount: '10.00' }],
    status: 'POSTED',
  },
  {
    narration: 'Batch B',
    debits: [{ accountId: 'acc-a', amount: '5.00' }],
    credits: [{ accountId: 'acc-b', amount: '5.00' }],
    status: 'POSTED',
  },
]);
```

### 4.2. Batch Post / Void
```ts
await ledger.postBatch(['id1', 'id2']);
await ledger.voidBatch(['id3', 'id4']);
```

## 5. Reporting

### 5.1. Account Statement
```ts
const statement = await new AccountStatement().getStatement('acc-cash', 100);
```

### 5.2. Trial Balance
```ts
const report = await new TrialBalance().getReport();
```

### 5.3. Balance Sheet
```ts
const tree = await new BalanceSheet().generate();
```

### 5.4. General Ledger
```ts
const gl = await new GeneralLedger().getReport('acc-cash', new Date('2026-01-01'), new Date());
```

## 6. Integrity & Jobs

### 6.1. Snapshot
```ts
await runSnapshotJob({ autoClose: true });
```

### 6.2. Seal Ledger
```ts
await runSealLedgerJob({ autoClose: true });
```

### 6.3. Verify Integrity
```ts
await runVerifyIntegrityJob({ autoClose: true });
```

### 6.4. Structural Checks
```ts
await runIntegrityChecksJob({ autoClose: true });
```

### 6.5. EOD Rebuild
```ts
await runEodRebuildJob({ autoClose: true });
```

## 7. Audit Logs

### 7.1. List Logs
```ts
const logs = await AuditService.list(50);
```

### 7.2. By Target
```ts
const logs = await AuditService.findByTarget('acc-cash', 50);
```

### 7.3. By Actor
```ts
const logs = await AuditService.findByActor('user-1', 50);
```

## 8. Checkpoints Summary
- Double-entry always enforced
- Overdraft blocked unless explicitly allowed
- Pending reservations enforced
- Balance snapshots can be scheduled
- Hash chain seal/verify for tamper evidence

