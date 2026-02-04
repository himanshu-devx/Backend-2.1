# CLAUDE.md - AI Assistant Guide for fintech-bun-hono

This document provides comprehensive guidance for AI assistants working with this codebase.

## Project Overview

**fintech-bun-hono** is a multi-instance fintech payment platform backend built with Bun and Hono. It handles payment processing (payin/payout), merchant management, and administrative operations for a payment gateway service.

### Key Characteristics
- **Multi-instance architecture**: Separate API (port 4000), Payment (port 3000), and Worker (port 4001) services
- **Dual database design**: MongoDB for business data, PostgreSQL for ledger/accounting
- **Double-entry accounting**: PostgreSQL-based banking-grade ledger system
- **Multi-provider support**: Pluggable payment gateway integrations (AlphaPay, Razorpay)
- **Enterprise security**: IP whitelisting, Argon2 hashing, JWT auth, audit logging
- **Background processing**: Worker instance with cron jobs for settlements and reconciliation

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3.1 |
| Framework | Hono 4.6.0 |
| Language | TypeScript 5.6.3 (strict mode) |
| Business DB | MongoDB 6.10 with Mongoose 8.19 |
| Ledger DB | PostgreSQL (banking-grade double-entry) |
| Cache | Redis (ioredis 5.8) |
| Validation | Zod 3.23 |
| Auth | JWT + Argon2 |
| Observability | OpenTelemetry + Pino logging |
| Build | Turbo 2.6 |

## Project Structure

```
src/
├── instances/           # Entry points
│   ├── api.ts           # API service (port 4000)
│   ├── payment.ts       # Payment service (port 3000)
│   └── worker.ts        # Background worker (port 4001)
├── app.ts               # Hono app factory with middleware stack
├── bootstrap.ts         # Service initialization (MongoDB + PostgreSQL)
├── config/              # Environment and provider credentials
├── routes/              # API route definitions
│   ├── admin/           # Admin portal routes
│   ├── auth/            # Authentication routes
│   ├── merchant/        # Merchant portal routes
│   └── payment/         # Payment processing routes
├── controllers/         # HTTP request handlers
├── services/            # Business logic layer
│   ├── admin/           # Admin services
│   ├── merchant/        # Merchant services
│   ├── payment/         # Payment processing
│   ├── ledger/          # TigerBeetle integration (legacy)
│   ├── ledger-pg/       # PostgreSQL ledger services (NEW)
│   ├── worker/          # Background job services
│   └── analytics/       # Reporting services
├── models/              # Mongoose schemas (MongoDB)
├── repositories/        # Data access layer
├── dto/                 # Zod validation schemas
├── middlewares/         # HTTP middleware
├── infra/               # Infrastructure
│   ├── mongoose-instance.ts  # MongoDB connection
│   ├── postgres/        # PostgreSQL connection & migrations
│   ├── redis-instance.ts     # Redis connection
│   └── otel-sdk.ts      # OpenTelemetry setup
├── providers/           # Payment gateway integrations
├── constants/           # Application constants
├── types/               # TypeScript type definitions
└── utils/               # Utility functions
```

## Development Commands

```bash
# Development (watch mode)
npm run dev              # All services (API, Payment, Worker)
npm run dev:api          # API service only
npm run dev:payment      # Payment service only
npm run dev:worker       # Worker service only

# Build
npm run build            # Build all services
npm run build:api        # Build API only
npm run build:payment    # Build Payment only
npm run build:worker     # Build Worker only

# Production
npm run start            # Run all built services
npm run start:services   # Run API and Payment only (without worker)

# Database
npm run db:migrate       # Run PostgreSQL migrations

# Type checking
npm run typecheck        # TypeScript validation
```

## Database Architecture

### Dual Database Design

This project uses **two databases** with clear separation of concerns:

| Database | Purpose | Data Types |
|----------|---------|------------|
| MongoDB | Business data | Merchants, Admins, Transactions (metadata), Providers, etc. |
| PostgreSQL | Financial ledger | Accounts, Transfers, Entries, Settlements, Reconciliation |

### PostgreSQL Ledger Schema

The ledger system implements **banking-grade double-entry accounting**:

```sql
-- Core Tables
ledger_accounts       -- All financial accounts with real-time balances
ledger_entries        -- Immutable journal entries (audit trail)
ledger_transfers      -- Double-entry transfers (debit + credit)
balance_snapshots     -- Daily balance snapshots for reconciliation
settlement_batches    -- Batch settlement tracking
reconciliation_log    -- Reconciliation audit log
scheduled_jobs        -- Cron job tracking
```

### Account Types

| Account Type | Owner Type | Purpose |
|--------------|------------|---------|
| MERCHANT_PAYIN | MERCHANT | Incoming payments |
| MERCHANT_PAYOUT | MERCHANT | Available for withdrawal |
| MERCHANT_HOLD | MERCHANT | Frozen/disputed funds |
| LEGAL_ENTITY_MAIN | LEGAL_ENTITY | Settlement account |
| PROVIDER_PAYIN | PROVIDER_LEGAL_ENTITY | Gateway collections |
| PROVIDER_PAYOUT | PROVIDER_LEGAL_ENTITY | Gateway liquidity |
| PROVIDER_EXPENSE | PROVIDER_LEGAL_ENTITY | Fee tracking |
| SUPER_ADMIN_INCOME | SUPER_ADMIN | Platform revenue |
| WORLD_MAIN | WORLD | External source/sink |

### Balance Model

Each account tracks **four balance dimensions**:

```typescript
{
  debits_pending: bigint,   // Reserved outgoing
  debits_posted: bigint,    // Confirmed outgoing
  credits_pending: bigint,  // Reserved incoming
  credits_posted: bigint,   // Confirmed incoming
}

// Net balance = credits_posted - debits_posted
// Available = net_balance - debits_pending
```

## Architecture Patterns

### Service Layer Pattern
Business logic resides in `src/services/`. Controllers are thin and delegate to services:
```typescript
// Controller calls service
const result = await merchantService.createMerchant(data);
return c.json({ success: true, data: result });
```

### PostgreSQL Ledger Services

Use the new PostgreSQL ledger services for all financial operations:

```typescript
import {
  PgLedgerService,
  PgAccountManagerService,
  PgSettlementService,
  rupeeToPaisa,
  paisaToRupee,
} from "@/services/ledger-pg";

// Create accounts
await PgLedgerService.createMerchantAccounts(merchantId, merchantName);

// Create transfer
await PgLedgerService.createTransfer({
  debitAccountId: fromAccount,
  creditAccountId: toAccount,
  amount: rupeeToPaisa(100.50),  // Always use paisa
  operationCode: OPERATION_CODES.PAYIN,
  description: "Customer payment",
});

// Get balance
const balance = await PgLedgerService.getBalance(accountId);
console.log(paisaToRupee(balance.netBalance));  // Convert back to rupees
```

### DTO Validation with Zod
All API inputs are validated using Zod schemas in `src/dto/`:
```typescript
import { z } from "zod";

export const CreateMerchantDto = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});
```

### Repository Pattern
Data access is abstracted through repositories in `src/repositories/`:
```typescript
const merchant = await merchantRepository.findById(id);
```

## Code Conventions

### Path Aliases
Use `@/` for imports from `src/`:
```typescript
import { ENV } from "@/config/env";
import { MerchantModel } from "@/models/merchant.model";
```

### File Naming
- Models: `*.model.ts` (e.g., `merchant.model.ts`)
- Controllers: `*.controller.ts`
- Services: `*.service.ts`
- DTOs: `*.dto.ts`
- Routes: `*.routes.ts`
- Middleware: `*.middleware.ts`

### Currency Handling

**CRITICAL**: All monetary amounts in the ledger are stored in **paisa** (1/100 INR):

```typescript
import { rupeeToPaisa, paisaToRupee } from "@/services/ledger-pg";

// Always convert when interfacing with ledger
const amountPaisa = rupeeToPaisa(100.50);  // 10050n

// Convert back for display/API responses
const amountRupee = paisaToRupee(10050n);  // 100.50
```

### Error Handling
Use the custom error utilities in `src/utils/error.ts`:
```typescript
import { AppError, NotFoundError, ValidationError } from "@/utils/error";
throw new NotFoundError("Merchant not found");
```

### Response Format
All API responses follow this structure:
```typescript
// Success
{ success: true, data: {...}, message?: "..." }

// Error
{ success: false, error: "...", message: "..." }
```

## Worker Instance & Cron Jobs

The worker instance (`src/instances/worker.ts`) handles background processing:

### Registered Jobs

| Job Name | Schedule | Purpose |
|----------|----------|---------|
| merchant-settlement | Every hour | Move payin → payout |
| provider-settlement | Every 6 hours | Settle provider fees |
| expired-transfer-cleanup | Every 15 min | Void expired pending transfers |
| reconciliation | Daily 2 AM | Verify ledger integrity |
| constraint-validation | Every 4 hours | Check balance constraints |
| balance-snapshot | Daily midnight | Create balance snapshots |

### Manual Job Triggers

```bash
# Trigger a job manually
curl -X POST http://localhost:4001/jobs/merchant-settlement/trigger

# Enable/disable a job
curl -X POST http://localhost:4001/jobs/reconciliation/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# List all jobs
curl http://localhost:4001/jobs
```

## Environment Variables

Key variables (see `.env.example`):

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGO_DB_NAME=smartFintech

# PostgreSQL Ledger
POSTGRES_LEDGER_URL=postgresql://localhost:5432/fintech_ledger
POSTGRES_POOL_SIZE=20

# Services
PAYMENT_PORT=3000
API_PORT=4000
WORKER_PORT=4001

# Auth
JWT_SECRET=...

# Cache
REDIS_URL=redis://localhost:6379

# Worker/Cron
CRON_SETTLEMENT_ENABLED=true
CRON_RECONCILIATION_ENABLED=true
CRON_SNAPSHOT_ENABLED=true

# Legacy (TigerBeetle - being phased out)
TIGERBEETLE_CLUSTER_ID=0
TIGERBEETLE_REPLICA_ADDRESSES=

# Email
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...

# Security
SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED=false
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60

# Observability
OTLP_HTTP_URL=...
LOG_LEVEL=info
```

## API Structure

### Route Prefixes
- `/api/auth/*` - Authentication (login, register, OTP)
- `/api/admin/*` - Admin portal operations
- `/api/merchant/*` - Merchant portal operations
- `/api/payment/*` - Payment processing (payin/payout)
- `/api/seed/*` - Development data seeding

### Common Query Parameters
```typescript
// Pagination
?page=1&limit=20

// Sorting
?sort=createdAt&order=desc

// Search
?search=keyword

// Filters (entity-specific)
?status=SUCCESS&merchantId=MID-001
```

## Security Considerations

### When Modifying Code
1. **Never hardcode secrets** - Use environment variables
2. **Validate all inputs** - Use Zod DTOs
3. **Check IP whitelisting** - Admin routes enforce IP restrictions
4. **Use parameterized queries** - Both Mongoose and postgres handle this
5. **Hash passwords** - Use Argon2 via existing utilities
6. **Log sensitive operations** - Use AuditService for admin actions
7. **Use transactions** - PostgreSQL ledger operations are atomic

### Authentication Flow
1. User submits credentials
2. Server validates and sends OTP
3. User verifies OTP
4. Server returns JWT token
5. Subsequent requests include `Authorization: Bearer <token>`

## Common Tasks

### Adding a New API Endpoint
1. Define Zod schema in `src/dto/`
2. Create/update service in `src/services/`
3. Add controller method in `src/controllers/`
4. Register route in `src/routes/`
5. Apply appropriate middleware (auth, validation)

### Adding a New Payment Provider
1. Create provider in `src/providers/` extending base
2. Implement required interface methods
3. Register in provider factory
4. Add credentials to config

### Adding a New Ledger Operation
1. Add operation code in `src/services/ledger-pg/pg-ledger.service.ts`
2. Add to `operation_codes` table migration
3. Implement in `PgSettlementService` if needed
4. Create appropriate API endpoints

### Adding a New Cron Job
1. Create job function in `src/services/worker/jobs/`
2. Register in `src/instances/worker.ts` with cron expression
3. Add environment variable for enable/disable if needed

## Build & Deployment

### Build Process
```bash
bun build src/instances/api.ts --target=bun --outdir=dist --outfile=api.js
bun build src/instances/payment.ts --target=bun --outdir=dist --outfile=payment.js
bun build src/instances/worker.ts --target=bun --outdir=dist --outfile=worker.js
```

External packages (native bindings): `tigerbeetle-node`, `argon2`, `postgres`

### Database Setup

**PostgreSQL** (required for ledger):
```bash
# Create database
createdb fintech_ledger

# Run migrations
npm run db:migrate
```

### Deployment Options
1. **Systemd** - Use `deploy.sh` for Linux servers
2. **PM2** - Use `ecosystem.config.cjs`
3. **Docker** - See `docker/docker-compose.yaml` for OTEL services

## Troubleshooting

### Common Issues
- **Port conflicts**: API=4000, Payment=3000, Worker=4001
- **PostgreSQL connection**: Ensure `POSTGRES_LEDGER_URL` is correct
- **MongoDB connection**: Check URI and network access
- **Redis connection**: Verify REDIS_URL format (rediss:// for TLS)
- **Migration failures**: Check PostgreSQL logs and user permissions

### Logs
- Development: Console output with pino-pretty
- Production: JSON logs via Pino
- Tracing: OpenTelemetry to configured OTLP endpoint

## Important Notes for AI Assistants

1. **Dual database architecture**: MongoDB for business data, PostgreSQL for ledger
2. **Always use paisa**: Convert to/from rupees at API boundaries
3. **Financial accuracy**: Double-entry must balance; use transactions
4. **Idempotency**: Use idempotency keys for ledger operations
5. **Security-first**: This handles real money - validate everything
6. **Existing patterns**: Follow established patterns for consistency
7. **Worker awareness**: Background jobs handle settlements automatically
8. **Type safety**: TypeScript strict mode is enabled; resolve all type errors
9. **Migration period**: TigerBeetle code exists but PostgreSQL is primary

## Migration from TigerBeetle

The codebase is transitioning from TigerBeetle to PostgreSQL:

| Old (TigerBeetle) | New (PostgreSQL) |
|-------------------|------------------|
| `LedgerService` | `PgLedgerService` |
| `AccountManagerService` | `PgAccountManagerService` |
| `SettlementService` | `PgSettlementService` |
| `LedgerAccountModel` (Mongo) | `ledger_accounts` (Postgres) |

Use the new `@/services/ledger-pg` services for all new development.
