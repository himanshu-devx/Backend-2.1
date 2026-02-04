# CLAUDE.md - AI Assistant Guide for fintech-bun-hono

This document provides comprehensive guidance for AI assistants working with this codebase.

## Project Overview

**fintech-bun-hono** is a multi-instance fintech payment platform backend built with Bun and Hono. It handles payment processing (payin/payout), merchant management, and administrative operations for a payment gateway service.

### Key Characteristics
- **Multi-instance architecture**: Separate API (port 4000) and Payment (port 3000) services
- **Double-entry accounting**: TigerBeetle ledger for financial transactions
- **Multi-provider support**: Pluggable payment gateway integrations (AlphaPay, Razorpay)
- **Enterprise security**: IP whitelisting, Argon2 hashing, JWT auth, audit logging

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3.1 |
| Framework | Hono 4.6.0 |
| Language | TypeScript 5.6.3 (strict mode) |
| Primary DB | MongoDB 6.10 with Mongoose 8.19 |
| Ledger DB | TigerBeetle (double-entry accounting) |
| Cache | Redis (ioredis 5.8) |
| Validation | Zod 3.23 |
| Auth | JWT + Argon2 |
| Observability | OpenTelemetry + Pino logging |
| Build | Turbo 2.6 |

## Project Structure

```
src/
├── instances/           # Entry points (api.ts, payment.ts)
├── app.ts               # Hono app factory with middleware stack
├── bootstrap.ts         # Service initialization
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
│   ├── ledger/          # TigerBeetle integration
│   └── analytics/       # Reporting services
├── models/              # Mongoose schemas
├── repositories/        # Data access layer
├── dto/                 # Zod validation schemas
├── middlewares/         # HTTP middleware
├── infra/               # Infrastructure (DB, Redis, OTEL, Email)
├── providers/           # Payment gateway integrations
├── constants/           # Application constants
├── types/               # TypeScript type definitions
└── utils/               # Utility functions
```

## Development Commands

```bash
# Development (watch mode)
npm run dev              # Both services concurrently
npm run dev:api          # API service only
npm run dev:payment      # Payment service only

# Build
npm run build            # Build both services
npm run build:api        # Build API only
npm run build:payment    # Build Payment only

# Production
npm run start            # Run built bundles

# Type checking
npm run typecheck        # TypeScript validation
```

## Architecture Patterns

### Service Layer Pattern
Business logic resides in `src/services/`. Controllers are thin and delegate to services:
```typescript
// Controller calls service
const result = await merchantService.createMerchant(data);
return c.json({ success: true, data: result });
```

### DTO Validation with Zod
All API inputs are validated using Zod schemas in `src/dto/`:
```typescript
import { z } from "zod";

export const CreateMerchantDto = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  // ...
});
```

### Repository Pattern
Data access is abstracted through repositories in `src/repositories/`:
```typescript
// Use repositories for database operations
const merchant = await merchantRepository.findById(id);
```

### Provider Factory Pattern
Payment gateways use a factory pattern in `src/providers/`:
```typescript
// base-provider.ts defines interface
// alphapay.provider.ts implements it
// provider-factory.ts creates instances
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

### Custom ID Generation
Use `generateCustomId()` for entity IDs:
```typescript
// Generates sequential IDs like MID-001, ADM-001, TXN-001
const merchantId = await generateCustomId("MID", MerchantModel);
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

## Database Models

### Core Entities
| Model | Purpose | Prefix |
|-------|---------|--------|
| AdminModel | System administrators | ADM |
| MerchantModel | Payment merchants | MID |
| TransactionModel | Payment transactions | TXN |
| ProviderModel | Payment gateways | PRV |
| LegalEntityModel | Banking entities | LE |
| ProviderLegalEntityModel | Provider-entity links | PLE |
| MerchantBankAccountModel | Merchant bank accounts | MBA |
| LedgerAccountModel | TigerBeetle accounts | - |
| AuditLogModel | Admin action audit | - |
| LoginHistoryModel | Login tracking | - |

### Transaction States
```typescript
enum TransactionStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED"
}
```

## Middleware Stack

Applied in order in `src/app.ts`:
1. `secureHeaders` - Security headers
2. `cors` - CORS configuration
3. `contextMiddleware` - Request context
4. `safeBody` - Body parsing
5. `traceContext` - Distributed tracing (X-Request-ID)
6. `loggerContext` - Logger initialization
7. `errorHandler` - Global error handling
8. `requestLogger` - HTTP request logging

Route-specific middleware:
- `authMiddleware` - JWT validation
- `panelIpWhitelistMiddleware` - IP restrictions
- `rateLimiter` - Rate limiting

## Environment Variables

Key variables (see `.env.example`):

```bash
# Database
MONGODB_URI=...
MONGO_DB_NAME=smartFintech

# Services
PORT=3000                    # Payment service
API_PORT=4000                # API service (implicit)

# Auth
JWT_SECRET=...

# Cache
REDIS_URL=...

# Ledger
TIGERBEETLE_CLUSTER_ID=0
TIGERBEETLE_REPLICA_ADDRESSES=...

# Email
SMTP_HOST=...
SMTP_PORT=...
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
4. **Use parameterized queries** - Mongoose handles this, but be careful with raw queries
5. **Hash passwords** - Use Argon2 via existing utilities
6. **Log sensitive operations** - Use AuditService for admin actions

### Authentication Flow
1. User submits credentials
2. Server validates and sends OTP
3. User verifies OTP
4. Server returns JWT token
5. Subsequent requests include `Authorization: Bearer <token>`

## Testing

Currently no automated test suite. When adding tests:
- Place in `__tests__/` directories or `*.test.ts` files
- Use Bun's built-in test runner or Vitest
- Mock external services (payment providers, email)

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

### Adding a New Model
1. Create schema in `src/models/`
2. Add counter prefix to `generateCustomId()` if needed
3. Create repository if complex queries needed
4. Add DTOs for API operations

## Build & Deployment

### Build Process
```bash
bun build src/instances/api.ts --target=bun --outdir=dist --outfile=api.js
bun build src/instances/payment.ts --target=bun --outdir=dist --outfile=payment.js
```

External packages (native bindings): `tigerbeetle-node`, `argon2`

### Deployment Options
1. **Systemd** - Use `deploy.sh` for Linux servers
2. **PM2** - Use `ecosystem.config.cjs`
3. **Docker** - See `docker/docker-compose.yaml` for OTEL services

## Troubleshooting

### Common Issues
- **Port conflicts**: API uses 4000, Payment uses 3000
- **TigerBeetle connection**: Ensure cluster ID and addresses are correct
- **MongoDB connection**: Check URI and network access
- **Redis connection**: Verify REDIS_URL format (rediss:// for TLS)

### Logs
- Development: Console output with pino-pretty
- Production: JSON logs via Pino
- Tracing: OpenTelemetry to configured OTLP endpoint

## Important Notes for AI Assistants

1. **Multi-instance awareness**: Changes may need to apply to both API and Payment instances
2. **Financial accuracy**: Double-entry accounting must balance; test ledger operations carefully
3. **Security-first**: This handles real money - validate inputs, check permissions, audit actions
4. **Existing patterns**: Follow established patterns in the codebase for consistency
5. **No tests currently**: Be extra careful with changes; consider adding tests for critical paths
6. **Type safety**: TypeScript strict mode is enabled; resolve all type errors
