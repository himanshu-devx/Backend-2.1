# Manual Operations

These APIs are admin-only and require the `x-admin-email` header. They do **not** use merchant context.

## Common Header
- `x-admin-email: admin@yourcompany.com`
- `Content-Type: application/json`

## Manual Status Update
`POST /payment/manual/status/update`

Body:
```json
{
  "orderId": "ORD12345",
  "status": "SUCCESS",
  "utr": "UTR123",
  "providerTransactionId": "PROV123",
  "providerMsg": "manual fix",
  "reason": "manual correction"
}
```

Notes:
- Updates status and applies ledger changes.
- If status flips after a prior post/void, a **new ledger entry** is created (no old entry is modified).

## Manual Status Sync (Provider Fetch + Update)
`POST /payment/manual/status/sync`

Body:
```json
{
  "transactionId": "TXN12345"
}
```

Notes:
- Fetches provider status and applies the same logic as manual update.
- If provider returns `PENDING/PROCESSING`, no update is applied.

## Expire Previous Day Pending Payins (IST)
`POST /payment/manual/expire/pending-previous-day`

Body (optional):
```json
{
  "reason": "ops cleanup"
}
```

Notes:
- Expires only `PAYIN` transactions from **previous day (IST)** that are still `PENDING/PROCESSING`.
- Sends merchant callbacks and records audit events.

## Provider Fee Settlement (Previous Day / Custom Date, IST)
`POST /payment/manual/provider-fee-settlement`

Body (optional):
```json
{
  "date": "YYYY-MM-DD"
}
```

Notes:
- If `date` is omitted, uses **previous day (IST)**.
- Skips PLEs that already have settlement transactions for that date.
- Enqueues settlement jobs (processed by the worker).
