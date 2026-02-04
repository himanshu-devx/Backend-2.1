# Fintech Bun + Hono (Single repo, Multi instances)

Instances:

- api (public)
- payment (internal/payments)
- worker (cron/background)

## Dev

```
bun install
cp .env.example .env
bun run dev
```

Run only one:

```
bun run dev:api
bun run dev:payment
bun run dev:worker
```

## Build bundles

```
bun run build
ls dist
```

## Docker

```
docker compose up --build
```

## Env

See `.env.example`.

# Backend

## API Documentation

### Common Query Parameters

For list endpoints (`GET`), standard pagination and search keys are supported:

- `page` (number, default: 1)
- `limit` (number, default: 10)
- `search` (string, optional)
- `sort` (string, optional, e.g. `email,-createdAt`)

---

### 1. Admin Auth

Base URL: `/api/auth/admin`

| Method | Endpoint                 | Description              | Body / Params                                   |
| :----- | :----------------------- | :----------------------- | :---------------------------------------------- |
| `POST` | `/create-super-admin`    | Create first Super Admin | `{ name, email, password (opt), role, status }` |
| `POST` | `/login`                 | Admin Login              | `{ email, password, deviceId (opt) }`           |
| `POST` | `/verify-otp`            | Verify OTP (2FA)         | `{ email, otp, deviceId }`                      |
| `POST` | `/reset-password/:email` | Initiate Password Reset  | `email` (URL param)                             |

---

### 2. Merchant Auth

Base URL: `/api/auth/merchant`

| Method | Endpoint                 | Description             | Body / Params                         |
| :----- | :----------------------- | :---------------------- | :------------------------------------ |
| `POST` | `/register`              | Register new Merchant   | `{ name, email, password (opt) }`     |
| `POST` | `/login`                 | Merchant Login          | `{ email, password, deviceId (opt) }` |
| `POST` | `/verify-otp`            | Verify OTP (2FA)        | `{ email, otp, deviceId }`            |
| `POST` | `/reset-password/:email` | Initiate Password Reset | `email` (URL param)                   |

---

### 3. Admin Management

Base URL: `/api/admin`

#### Sub-Admin Management

| Method  | Endpoint                  | Description               | Body / Params                                                        |
| :------ | :------------------------ | :------------------------ | :------------------------------------------------------------------- |
| `POST`  | `/create-admin`           | Create Sub-Admin          | `{ name, email, password (opt), role, status }`                      |
| `GET`   | `/list-admins`            | List Admins               | Query: `{ page, limit, search, sort }`                               |
| `GET`   | `/:id`                    | Get Admin Profile         | `id` (URL param)                                                     |
| `PATCH` | `/:id/status`             | Update Status             | `{ newStatus }`                                                      |
| `PATCH` | `/:id/role`               | Update Role               | `{ newRole }`                                                        |
| `PUT`   | `/:id/panel-ip-whitelist` | Update Panel IP Whitelist | `{ panelIpWhitelist: string[], isPanelIpWhitelistEnabled: boolean }` |
| `PUT`   | `/:id/profile`            | Update Admin Profile      | `{ name, password }`                                                 |

#### Merchant Management (by Admin)

Base URL: `/api/admin/merchants`

| Method   | Endpoint                  | Description               | Body / Params                                                                              |
| :------- | :------------------------ | :------------------------ | :----------------------------------------------------------------------------------------- |
| `GET`    | `/list-merchants`         | List Merchants            | Query: `{ page, limit, search, sort }`                                                     |
| `GET`    | `/:id`                    | Get Merchant Profile      | `id` (URL param)                                                                           |
| `PATCH`  | `/:id/status`             | Update Merchant Status    | `{ newStatus }`                                                                            |
| `PUT`    | `/:id/panel-ip-whitelist` | Update Panel IP Whitelist | `{ panelIpWhitelist: string[], isPanelIpWhitelistEnabled: boolean }`                       |
| `PUT`    | `/:id/payin-config`       | Update Payin Config       | `{ isActive, tps, dailyLimit, apiIpWhitelist (Max 5, Replaces), isApiIpWhitelistEnabled }` |
| `PUT`    | `/:id/payout-config`      | Update Payout Config      | `{ isActive, tps, dailyLimit, apiIpWhitelist (Max 5, Replaces), isApiIpWhitelistEnabled }` |
| `POST`   | `/:id/payin-config/fees`  | Add Payin Fee Tier        | `{ fromAmount, toAmount, charge: { flat, percentage, taxRate, strategy } }`                |
| `DELETE` | `/:id/payin-config/fees`  | Delete Payin Fee Tier     | `{ fromAmount }`                                                                           |
| `POST`   | `/:id/payout-config/fees` | Add Payout Fee Tier       | `{ fromAmount, toAmount, charge: { flat, percentage, taxRate, strategy } }`                |
| `DELETE` | `/:id/payout-config/fees` | Delete Payout Fee Tier    | `{ fromAmount }`                                                                           |

#### Provider Management

Base URL: `/api/admin/providers`

| Method | Endpoint | Description     | Body / Params                                              |
| :----- | :------- | :-------------- | :--------------------------------------------------------- |
| `GET`  | `/`      | List Providers  | Query: `{ page, limit, search }`                           |
| `POST` | `/`      | Create Provider | `{ name, type, capabilities: { payin, payout } }`          |
| `GET`  | `/:id`   | Get Provider    | `id` (URL param)                                           |
| `PUT`  | `/:id`   | Update Provider | `{ name, type, capabilities }` (Partial updates supported) |

#### Legal Entity Management

Base URL: `/api/admin/legal-entities`

| Method | Endpoint | Description         | Body / Params                                                     |
| :----- | :------- | :------------------ | :---------------------------------------------------------------- |
| `GET`  | `/`      | List Legal Entities | Query: `{ page, limit, search }`                                  |
| `POST` | `/`      | Create Legal Entity | `{ name, identifier, bankAccount: { accountNumber, ifsc, ... } }` |
| `GET`  | `/:id`   | Get Legal Entity    | `id` (URL param)                                                  |
| `PUT`  | `/:id`   | Update Legal Entity | `{ name, bankAccount }` (Partial updates supported)               |

#### Provider-Legal Entity Links

Base URL: `/api/admin/provider-legal-entity`

| Method   | Endpoint           | Description          | Body / Params                                            |
| :------- | :----------------- | :------------------- | :------------------------------------------------------- |
| `GET`    | `/`                | List Links           | Query: `{ page, limit }`                                 |
| `POST`   | `/`                | Create/Link          | `{ providerId, legalEntityId, payin, payout }`           |
| `GET`    | `/:id`             | Get Link Details     | `id` (URL param)                                         |
| `PUT`    | `/:id/payin`       | Update Payin Config  | `{ isActive, tps, accounts: { collectionEscrowId... } }` |
| `POST`   | `/:id/payin/fees`  | Add Payin Fee        | `{ fromAmount, toAmount, charge }`                       |
| `DELETE` | `/:id/payin/fees`  | Delete Payin Fee     | `{ fromAmount }`                                         |
| `PUT`    | `/:id/payout`      | Update Payout Config | `{ isActive, tps, accounts: { payoutEscrowId... } }`     |
| `POST`   | `/:id/payout/fees` | Add Payout Fee       | `{ fromAmount, toAmount, charge }`                       |
| `DELETE` | `/:id/payout/fees` | Delete Payout Fee    | `{ fromAmount }`                                         |

#### Merchant Bank Account Requests

155:
156: Base URL: `/api/admin/merchant-bank-accounts`
157:
158: | Method | Endpoint | Description | Body / Params |
159: | :----- | :------------ | :---------------- | :------------------------------ |
160: | `GET` | `/` | List Requests | Query: `{ status: PENDING }` |
161: | `PUT` | `/:id/status` | Approve/Reject | `{ status: APPROVED/REJECTED }` |
162: | `PUT` | `/:id/active` | Toggle Active | `{ isActive: boolean }` |
163:
164: #### Login History (Admin)
165:
166: | Method | Endpoint | Description | Body / Params |
167: | :----- | :------------------- | :-------------- | :------------------------------------- |
168: | `GET` | `/login-history` | Get Own History | - |
169: | `GET` | `/login-history-all` | Get All History | Query: `{ page, limit, search, sort }` |

---

### 4. Merchant Portal

Base URL: `/api/merchant`

| Method | Endpoint         | Description           | Body / Params |
| :----- | :--------------- | :-------------------- | :------------ |
| `GET`  | `/login-history` | Get Own Login History | -             |

172:
173: #### Bank Account Management
174:
175: Base URL: `/api/merchant/bank-accounts`
176:
177: | Method | Endpoint | Description | Body / Params |
178: | :----- | :------- | :-------------------- | :--------------------------------------------------------------------- |
179: | `GET` | `/` | List My Accounts | - |
180: | `POST` | `/` | Add Bank Account | `{ accountNumber, ifsc, bankName, beneficiaryName }` (Status: PENDING) |
181: | `PUT` | `/:id` | Update Account | `{ ... }` (Resets status to PENDING) |
# Backend-2.1
