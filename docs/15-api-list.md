# API List (For RBAC Matrix Draft)

Source: `Backend-2.1/src/routes` and instance mounts in `Backend-2.1/src/instances`.
Note: This list intentionally omits any role mapping. Use it to build your permission matrix later.

## Base Paths

- API Service base: `/api`
- Payment Service base: `/api/payment`
- Webhooks base: `/webhook`
- Health check: `/health`

## API Service — Auth (`/api/auth`)

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/auth/admin/create-super-admin` | Create initial super admin account. |
| POST | `/api/auth/admin/login` | Admin login. |
| POST | `/api/auth/admin/verify-login-otp` | Verify admin login OTP. |
| POST | `/api/auth/admin/forgot-password` | Start admin password reset. |
| POST | `/api/auth/admin/confirm-reset-password` | Confirm admin password reset. |
| POST | `/api/auth/merchant/register` | Register merchant account. |
| POST | `/api/auth/merchant/login` | Merchant login. |
| POST | `/api/auth/merchant/verify-otp` | Verify merchant login OTP. |
| POST | `/api/auth/merchant/forgot-password` | Start merchant password reset. |
| POST | `/api/auth/merchant/confirm-reset-password` | Confirm merchant password reset. |
| POST | `/api/auth/refresh` | Refresh access token. |

## API Service — Admin (`/api/admin`)

### Admin Management

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/admin/create-admin` | Create a new admin user. |
| PUT | `/api/admin/profile` | Update own admin profile. |
| PUT | `/api/admin/:id/profile` | Update another admin’s profile. |
| GET | `/api/admin/list-admins` | List admins. |
| GET | `/api/admin/login-history` | Get own login history. |
| GET | `/api/admin/login-history-all` | Get all admin login history. |
| GET | `/api/admin/dashboard/stats` | Admin dashboard stats. |
| GET | `/api/admin/transactions` | List transactions (admin view). |
| GET | `/api/admin/transactions/by-ledger/:entryId` | Transaction details by ledger entry. |
| GET | `/api/admin/transactions/:id` | Transaction details by ID. |
| POST | `/api/admin/transactions/:id/reverse` | Reverse a transaction. |
| POST | `/api/admin/transactions/:id/reverse-ledger` | Reverse ledger entries for a transaction. |
| POST | `/api/admin/transactions/:id/sync-status` | Sync transaction status with provider. |
| POST | `/api/admin/transactions/:id/resend-webhook` | Resend merchant webhook. |
| GET | `/api/admin/:id` | Get admin profile by ID. |
| PUT | `/api/admin/:id/status` | Toggle admin status. |
| PATCH | `/api/admin/:id/role` | Update admin role (no role mapping included). |
| PUT | `/api/admin/:id/panel-ip-whitelist` | Update admin panel IP whitelist. |

### Merchant Management

| Method | Path | What It Does |
| --- | --- | --- |
| GET | `/api/admin/merchants/list-merchants` | List merchants. |
| GET | `/api/admin/merchants/:id` | Get merchant profile. |
| GET | `/api/admin/merchants/:id/activity` | Get merchant activity. |
| GET | `/api/admin/merchants/:id/bank-accounts` | Get merchant bank accounts. |
| POST | `/api/admin/merchants/:id/onboard` | Onboard a merchant. |
| PUT | `/api/admin/merchants/:id/status` | Toggle merchant status. |
| PUT | `/api/admin/merchants/:id/panel-ip-whitelist` | Update merchant panel IP whitelist. |
| PUT | `/api/admin/merchants/:id/profile` | Update merchant profile. |
| PUT | `/api/admin/merchants/:id/payin-config` | Update merchant payin config. |
| PUT | `/api/admin/merchants/:id/payout-config` | Update merchant payout config. |
| PUT | `/api/admin/merchants/:id/routing` | Update merchant routing rules. |
| POST | `/api/admin/merchants/:id/payin-config/fees` | Add payin fee tier. |
| DELETE | `/api/admin/merchants/:id/payin-config/fees` | Delete payin fee tier. |
| POST | `/api/admin/merchants/:id/payout-config/fees` | Add payout fee tier. |
| DELETE | `/api/admin/merchants/:id/payout-config/fees` | Delete payout fee tier. |
| GET | `/api/admin/merchants/:id/api-secret` | Get merchant API secret. |
| POST | `/api/admin/merchants/:id/rotate-api-secret` | Rotate merchant API secret. |
| PUT | `/api/admin/merchants/:id/toggle-api-secret` | Enable/disable merchant API secret. |

### Providers

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/admin/providers/` | Create provider. |
| GET | `/api/admin/providers/` | List providers. |
| GET | `/api/admin/providers/:id` | Get provider by ID. |
| PUT | `/api/admin/providers/:id` | Update provider. |

### Legal Entities

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/admin/legal-entities/` | Create legal entity. |
| GET | `/api/admin/legal-entities/` | List legal entities. |
| GET | `/api/admin/legal-entities/:id` | Get legal entity by ID. |
| PUT | `/api/admin/legal-entities/:id` | Update legal entity. |

### Provider Legal Entity

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/admin/provider-legal-entity/` | Create provider legal entity mapping. |
| GET | `/api/admin/provider-legal-entity/` | List provider legal entity mappings. |
| GET | `/api/admin/provider-legal-entity/:id` | Get mapping by ID. |
| PUT | `/api/admin/provider-legal-entity/:id/payin` | Update payin config. |
| POST | `/api/admin/provider-legal-entity/:id/payin/fees` | Add payin fee tier. |
| DELETE | `/api/admin/provider-legal-entity/:id/payin/fees` | Delete payin fee tier. |
| PUT | `/api/admin/provider-legal-entity/:id/payout` | Update payout config. |
| POST | `/api/admin/provider-legal-entity/:id/payout/fees` | Add payout fee tier. |
| DELETE | `/api/admin/provider-legal-entity/:id/payout/fees` | Delete payout fee tier. |

### Merchant Bank Accounts (Admin)

| Method | Path | What It Does |
| --- | --- | --- |
| GET | `/api/admin/merchant-bank-accounts/` | List merchant bank accounts (filterable). |
| PUT | `/api/admin/merchant-bank-accounts/:id/status` | Approve/reject bank account. |
| PUT | `/api/admin/merchant-bank-accounts/:id/active` | Toggle bank account active state. |

### Ledger (Admin)

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/admin/ledger/transfers` | Create manual ledger transfer. |
| POST | `/api/admin/ledger/operations` | Create predefined ledger operation. |
| GET | `/api/admin/ledger/accounts/:accountId/entries` | Get ledger entries for account. |
| GET | `/api/admin/ledger/accounts/:accountId/statement` | Get account statement. |
| GET | `/api/admin/ledger/accounts/:accountId/general-ledger` | Get general ledger for account. |
| GET | `/api/admin/ledger/entries/:entryId` | Get ledger entry by ID. |
| GET | `/api/admin/ledger/entries/:entryId/transaction` | Get transaction by ledger entry ID. |
| GET | `/api/admin/ledger/reports/trial-balance` | Get trial balance report. |
| GET | `/api/admin/ledger/reports/balance-sheet` | Get balance sheet report. |
| GET | `/api/admin/ledger/operations` | List ledger operations (all entity types). |
| GET | `/api/admin/ledger/operations/:entityType` | List ledger operations by entity type. |

### Reports (Admin)

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/admin/reports/transactions` | Request transaction report. |
| POST | `/api/admin/reports/accounts/:accountId/statement` | Request account statement report. |
| GET | `/api/admin/reports/` | List report requests (admin scope). |
| GET | `/api/admin/reports/:reportId/download` | Download report file. |

### Filters (Admin)

| Method | Path | What It Does |
| --- | --- | --- |
| GET | `/api/admin/filters/` | Get filter metadata for admin UI. |

## API Service — Merchant (`/api/merchant`)

### Merchant Bank Accounts

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/merchant/bank-accounts/` | Create merchant bank account. |
| GET | `/api/merchant/bank-accounts/` | List merchant bank accounts. |
| PUT | `/api/merchant/bank-accounts/:id` | Update merchant bank account. |

### Transactions (Merchant)

| Method | Path | What It Does |
| --- | --- | --- |
| GET | `/api/merchant/transactions/` | List merchant transactions. |
| GET | `/api/merchant/transactions/:id` | Get transaction details. |

### Ledger (Merchant)

| Method | Path | What It Does |
| --- | --- | --- |
| GET | `/api/merchant/ledger/accounts/:accountId/entries` | Get ledger entries for account. |
| GET | `/api/merchant/ledger/accounts/:accountId/statement` | Get account statement. |
| GET | `/api/merchant/ledger/accounts/:accountId/general-ledger` | Get general ledger for account. |
| GET | `/api/merchant/ledger/entries/:entryId` | Get ledger entry by ID. |

### Reports (Merchant)

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/merchant/reports/transactions` | Request transaction report. |
| POST | `/api/merchant/reports/accounts/:accountId/statement` | Request account statement report. |
| GET | `/api/merchant/reports/` | List report requests (merchant scope). |
| GET | `/api/merchant/reports/:reportId/download` | Download report file. |

### Merchant Self-Service

| Method | Path | What It Does |
| --- | --- | --- |
| GET | `/api/merchant/login-history` | Get merchant login history. |
| GET | `/api/merchant/profile/basic` | Get own basic profile. |
| GET | `/api/merchant/profile/payin` | Get own payin config. |
| GET | `/api/merchant/profile/payout` | Get own payout config. |
| GET | `/api/merchant/dashboard/stats` | Merchant dashboard stats. |
| PUT | `/api/merchant/config/callback-url` | Update callback URL. |
| GET | `/api/merchant/api-keys` | Get merchant API key/secret. |
| POST | `/api/merchant/api-keys` | Rotate merchant API key/secret. |
| PUT | `/api/merchant/profile` | Update own merchant profile. |

## Payment Service (`/api/payment`)

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/api/payment/payin/initiate` | Initiate payin. |
| POST | `/api/payment/uat/payin/initiate` | Initiate payin (UAT). |
| POST | `/api/payment/payout/initiate` | Initiate payout. |
| POST | `/api/payment/uat/payout/initiate` | Initiate payout (UAT). |
| GET | `/api/payment/:orderId` | Check combined transaction status by order ID. |
| GET | `/api/payment/uat/:orderId` | Check combined transaction status (UAT). |
| GET | `/api/payment/payin/status/:orderId` | Check payin status. |
| GET | `/api/payment/uat/payin/status/:orderId` | Check payin status (UAT). |
| GET | `/api/payment/payout/status/:orderId` | Check payout status. |
| GET | `/api/payment/uat/payout/status/:orderId` | Check payout status (UAT). |
| POST | `/api/payment/debug/provider-request` | Proxy/debug provider request. |
| POST | `/api/payment/manual/status/update` | Manual status update. |
| POST | `/api/payment/manual/status/sync` | Manual status sync with provider. |
| POST | `/api/payment/manual/expire/pending-previous-day` | Expire previous-day pending transactions. |
| POST | `/api/payment/manual/provider-fee-settlement` | Run provider fee settlement. |
| GET | `/api/payment/upi/:txnId` | Render UPI QR code for a transaction. |

## Webhooks (`/webhook`)

| Method | Path | What It Does |
| --- | --- | --- |
| POST | `/webhook/debug` | Capture debug webhook payload. |
| POST | `/webhook/debug/:tag` | Capture debug webhook payload with tag. |
| POST | `/webhook/:type/:provider/:legalentity` | Provider webhook (typed + legal entity). |
| POST | `/webhook/:type/:provider` | Provider webhook (typed). |

## Health

| Method | Path | What It Does |
| --- | --- | --- |
| GET | `/health` | Health check (API and Payment instances). |
