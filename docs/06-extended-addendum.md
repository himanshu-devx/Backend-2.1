# Volume 6 — Extended Technical Deep Dive (Backend, Data, Security, Ops)

This addendum expands the base report with detailed technical content for knowledge transfer. All details are derived from the repository; any missing information is explicitly marked as TBD.

---

## 1. Codebase Map (Backend)

**Root**: `Backend-2.1/src/`

- `app.ts` — App bootstrap / wiring
- `bootstrap.ts` — Initialization of infra and app
- `instances/` — Entry points
  - `api.ts` — Public API instance
  - `payment.ts` — Payment instance
  - `worker.ts` — Background worker instance
- `controllers/` — Request handlers
- `dto/` — Request validation schemas (Zod)
- `services/` — Core business logic
- `workflows/` — Orchestrated flow logic
- `middlewares/` — Security, auth, tracing, logging, context
- `models/` — Mongoose schemas (MongoDB)
- `provider-config/` — Provider adapters and HTTP client
- `utils/` — Helpers: JWT, encryption, date, money, etc.
- `cron/` — Cron job registration
- `jobs/` — Ledger jobs (seal, snapshot, integrity, optimize, EOD)

---

## 2. Backend Entry Points (Detailed)

### 2.1 `instances/api.ts`
- Primary HTTP API service
- Hono server with routes and middlewares
- Exposes health endpoint and external APIs

### 2.2 `instances/payment.ts`
- Payment‑specific API service
- Handles merchant payment flows and webhooks
- Imports `otel-sdk` for tracing/metrics

### 2.3 `instances/worker.ts`
- Background job processing
- Registers cron jobs and processes queues
- Imports `otel-sdk` for tracing/metrics

---

## 3. Controllers (Deep Dive)

### 3.1 `PaymentController`
**File**: `src/controllers/payment/payment.controller.ts`

Core responsibilities:
- Payin/payout initiation endpoints
- Manual admin endpoints
- Validation and error handling
- Audit logging for manual operations

Manual endpoints (admin):
- Manual status update
- Manual status sync
- Manual expire pending payins
- Manual provider fee settlement

### 3.2 `WebhookController`
**File**: `src/controllers/payment/webhook.controller.ts`

Responsibilities:
- Receives webhook payload
- Logs raw body and headers
- Forwards payload into workflow

---

## 4. Middlewares (Deep Dive)

### 4.1 `payment-security.middleware.ts`
Purpose: Merchant request security

Key controls:
- Signature validation (HMAC SHA‑256)
- Timestamp window (60s)
- IP whitelist enforcement
- Merchant lookup and activation checks
- Legacy signature support

### 4.2 `auth.middleware.ts`
Purpose: Auth for internal/admin endpoints

Key controls:
- JWT verification
- Role assignment
- Log context enrichment

### 4.3 `context.ts`
Purpose: Request context

Key controls:
- Creates `requestId` and `correlationId`
- Injects into AsyncLocalStorage log context

### 4.4 `trace-id.ts`
Purpose: Tracing for requests

Key controls:
- Creates span per request
- Extracts `traceId` and `spanId`
- Adds to log context

### 4.5 `request-logger.ts`
Purpose: Request metrics logging

Key controls:
- `event= http.request`
- Captures method, path, status, duration

---

## 5. Workflows (Deep Dive)

### 5.1 Payin Workflow (`workflows/payin.workflow.ts`)

Step‑by‑step:
1. Validate merchant and request payload
2. Check TPS limits
3. Create transaction record (PENDING)
4. Initiate provider payin
5. Store provider response
6. Return response to merchant
7. If status is PENDING, schedule auto expiry

### 5.2 Payout Workflow (`workflows/payout.workflow.ts`)

Step‑by‑step:
1. Validate merchant and request
2. Check TPS and limits
3. Create transaction record (PENDING)
4. Create ledger hold entry (PENDING)
5. Initiate payout at provider
6. If pending/processing, schedule polling
7. On success: commit ledger
8. On failure: void or reverse ledger

### 5.3 Webhook Workflow (`workflows/webhook.workflow.ts`)

Step‑by‑step:
1. Parse webhook payload
2. Resolve transaction by transactionId or provider reference
3. Validate if transaction already finalized
4. Update transaction status
5. Post or reverse ledger entries as required
6. Stop polling if payout
7. Notify merchant via callback

---

## 6. Services (Deep Dive)

### 6.1 PaymentService
File: `src/services/payment/payment.service.ts`

Responsibilities:
- Manual status updates (payin/payout)
- Status sync via provider
- Expire pending payins by date
- Provider fee settlement enqueue
- Ledger updates on status change

### 6.2 PaymentLedgerService
File: `src/services/payment/payment-ledger.service.ts`

Responsibilities:
- Ledger transfers for payin/payout
- Commit, void, and reverse entries
- Manual ledger entry tracking

### 6.3 TransactionMonitorService
File: `src/services/payment/transaction-monitor.service.ts`

Responsibilities:
- Schedule payin expiry jobs
- Schedule payout polling jobs
- Process polling results

### 6.4 LedgerTransferService
File: `src/services/ledger/ledger-transfer.service.ts`

Responsibilities:
- Resolve ledger accounts
- Validate valueDate/backdated logic
- Create transaction records tied to transfers
- Execute ledger transfer

### 6.5 LedgerOperationService
File: `src/services/ledger/ledger-operation.service.ts`

Responsibilities:
- Predefined operational ledger postings
- Translates high‑level operations into ledger transfers

### 6.6 LedgerEntryService
File: `src/services/ledger/ledger-entry.service.ts`

Responsibilities:
- Ledger entry listing and filters
- Account statements with balances
- General ledger/trial balance

### 6.7 ReportService
File: `src/services/common/report.service.ts`

Responsibilities:
- Generates CSV reports
- Handles merchant/admin filters

### 6.8 AuditService
File: `src/services/common/audit.service.ts`

Responsibilities:
- Structured audit logging
- Persists audit logs to MongoDB

### 6.9 CacheService
File: `src/services/common/cache.service.ts`

Responsibilities:
- Redis cache for merchants/providers
- Channel config overrides

### 6.10 ProviderFeeSettlementService
File: `src/services/provider-fee-settlement/provider-fee-settlement.service.ts`

Responsibilities:
- Enqueue settlement jobs by date
- Process settlement postings
- Verification workflows

---

## 7. Data Model and Schema Catalog (MongoDB)

### 7.1 Transaction
File: `models/transaction.model.ts`

Key fields:
- `id`, `orderId`, `type`, `status`
- `amount`, `netAmount`, `currency`
- `merchantId`, `providerId`, `legalEntityId`, `providerLegalEntityId`
- `providerRef`, `utr`, `paymentMode`, `remarks`
- `party` (customer/bank details)
- `fees` (merchant/provider)
- `events[]` (audit trail)
- `meta` (ledger entries, idempotency, etc.)
- `isBackDated`, `insertedDate`

Indexes:
- `{ providerId, providerRef }` unique
- `{ createdAt: -1 }`

### 7.2 Merchant
File: `models/merchant.model.ts`

Key fields:
- `id`, `name`, `displayName`, `email`
- `password` (argon2id hash)
- `status`, `isOnboard`
- `payin`, `payout` (SharedServiceConfig)
- `accounts` (ledger account IDs)

Indexes:
- `status`, `role`, `createdAt`, `payin.isActive`, `payout.isActive`

### 7.3 Provider
File: `models/provider.model.ts`

Key fields:
- `id`, `name`, `displayName`, `type`
- `capabilities` (payin/payout)

### 7.4 Provider Legal Entity (PLE)
File: `models/provider-legal-entity.model.ts`

Key fields:
- `id`, `providerId`, `legalEntityId`
- `payin`, `payout` (SharedServiceConfig)
- `webhooks` (payin/payout/common)
- `accounts` (ledger account IDs)

Indexes:
- `{ providerId, legalEntityId }` unique

### 7.5 Legal Entity
File: `models/legal-entity.model.ts`

Key fields:
- `id`, `name`, `displayName`, `identifier`, `gstin`
- `bankAccount`
- `accounts.bankAccountId`

### 7.6 Admin
File: `models/admin.model.ts`

Key fields:
- `id`, `name`, `email`, `role`, `status`
- `panelIpWhitelist`

### 7.7 Audit Log
File: `models/audit-log.model.ts`

Key fields:
- `action`, `actorId`, `actorType`
- `entityType`, `entityId`
- `metadata`, `traceId`, `requestId`

### 7.8 Generated Report
File: `models/generated-report.model.ts`

Key fields:
- `id`, `type`, `status`
- `ownerId`, `ownerType`, `ownerEmail`
- `filters`, `filePath`, `expiresAt`

### 7.9 Login History
File: `models/login-history.model.ts`

Key fields:
- `userId`, `userType`, `email`
- `ipAddress`, `browser`, `device`, `location`
- `status`, `failureReason`

### 7.10 Merchant Bank Account
File: `models/merchant-bank-account.model.ts`

Key fields:
- `id`, `merchantId`, `accountNumber`, `ifsc`
- `bankName`, `beneficiaryName`, `status`

### 7.11 Counter
File: `models/counter.model.ts`

Key fields:
- `_id` (sequence name)
- `seq` (counter)

---

## 8. Ledger Model (Postgres via fintech-ledger)

### 8.1 Ledger Account ID Format
Format: `{TYPE}:{ENTITY}:{ENTITY_ID}:{PURPOSE}`
Example: `LIABILITY:MERCHANT:MER-123:PAYIN`

### 8.2 Entity Types and Purposes
Defined in `constants/ledger.constant.ts`:
- Entities: MERCHANT, PROVIDER, LEGAL_ENTITY, INCOME, WORLD
- Purposes: PAYIN, PAYOUT, HOLD, BANK, INCOME, EXPENSE, WORLD

### 8.3 Ledger Operations
- `transfer` — creates a double‑entry record
- `post` — finalizes pending entry
- `reverse` — creates inverse entry
- `void` — cancels pending entry

### 8.4 Ledger Cron Jobs
Configured via env:
- Sealer
- Snapshot
- Integrity Check
- Optimize DB
- EOD rebuild

---

## 9. API Specification (Detailed)

### 9.1 Merchant Authentication
Headers required for merchant endpoints:
- `x-merchant-id`
- `x-timestamp`
- `x-signature`

Signature algorithm:
```
HMAC_SHA256(raw_body + "|" + timestamp, api_secret)
```

Legacy signature (if `x-signature` missing):
```
HMAC_SHA256(amount|currency|orderId|secret)
```

### 9.2 Payin Initiate
`POST /api/payment/payin/initiate`

Request fields:
- `amount` (number, integer)
- `orderId` (string, 10–25)
- `paymentMode` (`UPI`|`QR`|`INTENT`)
- `customerName`, `customerEmail`, `customerPhone`

Response fields:
- `orderId`, `transactionId`, `paymentUrl`, `amount`, `status`

### 9.3 Payout Initiate
`POST /api/payment/payout/initiate`

Request fields:
- `amount`, `orderId`, `paymentMode`
- `beneficiaryName`, `beneficiaryAccountNumber`, `beneficiaryIfsc`
- `beneficiaryBankName`

Response fields:
- `transactionId`, `orderId`, `status`, `utr`

### 9.4 Status Endpoints
- `GET /api/payment/:orderId`
- `GET /api/payment/payin/status/:orderId`
- `GET /api/payment/payout/status/:orderId`

### 9.5 UAT Endpoints
- `POST /api/payment/uat/payin/initiate`
- `POST /api/payment/uat/payout/initiate`
- `GET /api/payment/uat/:orderId`

### 9.6 Manual Admin Endpoints
- `POST /api/payment/manual/status/update`
- `POST /api/payment/manual/status/sync`
- `POST /api/payment/manual/expire/pending-previous-day`
- `POST /api/payment/manual/provider-fee-settlement`

---

## 10. Security and Cryptography

### 10.1 Secret Storage
- API secrets encrypted with AES‑256‑GCM
- Key derived from `API_SECRET_ENC_KEY` or `JWT_SECRET`

### 10.2 JWT Authentication
- JWT signed with `JWT_SECRET`
- Token expiry: 7 days

### 10.3 IP Whitelisting
- Configured in merchant payin/payout service config
- Optional bypass for trusted frontend origin in dev

---

## 11. Observability (Detailed)

### 11.1 Logs
- Pino structured JSON logging
- Context enrichment with requestId, traceId, merchantId
- Sensitive field redaction for provider HTTP

### 11.2 Metrics
- OpenTelemetry Prometheus exporter
- Default ports: 9464/9465/9466

### 11.3 Traces
- OpenTelemetry auto instrumentation
- Exported to Tempo via OTel Collector

---

## 12. Deployment & Ops Runbooks

### 12.1 Standard Deploy
1. Prepare env files under `Deployment/clients/<client>`
2. Deploy databases stack
3. Deploy monitoring stack
4. Deploy app stack
5. Validate health endpoints

### 12.2 Rollback
- Re‑deploy previous container images
- Verify database compatibility

### 12.3 Outage Handling
- Provider outage: freeze payout initiation or route to fallback
- Ledger integrity issues: run integrity check job

---

## 13. CI/CD (TBD)

- No pipeline definitions in repo
- Suggested flow:
  - Build backend image
  - Build frontend image
  - Run tests
  - Deploy via Ansible

---

## 14. DR/BCP (TBD)

- Backup strategies for Postgres/Mongo/Redis not specified
- Disaster recovery playbooks not defined

---

End of Volume 6.


---
