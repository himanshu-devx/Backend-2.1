# Volume 10 — Environment Variable Catalog

This catalog is derived from `src/config/env.ts`.

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | enum | `development` | Runtime environment |
| `API_PORT` | number | `4000` | API instance port |
| `PAYMENT_PORT` | number | `4001` | Payment instance port |
| `LOG_LEVEL` | string | `info` | Pino log level |
| `SERVICE_NAME` | string | `app-service` | Service name for OTel |
| `MONGODB_URI` | string | none | MongoDB connection string |
| `MONGO_DB_NAME` | string | none | Mongo database name |
| `OTLP_HTTP_URL` | string | none | OTel collector URL |
| `FRONTEND_URL` | string | none | Frontend URL (for whitelist bypass) |
| `POSTGRES_HOST` | string | `localhost` | Ledger DB host |
| `POSTGRES_PORT` | string | `5435` | Ledger DB port |
| `POSTGRES_USER` | string | `postgres` | Ledger DB user |
| `POSTGRES_PASSWORD` | string | `password` | Ledger DB password |
| `POSTGRES_DB` | string | `app_ledger` | Ledger DB name |
| `POSTGRES_POOL_MAX` | string | `20` | Ledger DB pool size |
| `MAIL_PROVIDER` | enum | `zeptomail` | Email provider |
| `MAIL_FROM_EMAIL` | string | none | Email sender |
| `MAIL_FROM_NAME` | string | none | Email sender name |
| `ZEPTOMAIL_API_KEY` | string | none | ZeptoMail API key |
| `ZEPTOMAIL_FROM_EMAIL` | string | none | ZeptoMail sender |
| `ZEPTOMAIL_FROM_NAME` | string | none | ZeptoMail sender name |
| `ZEPTOMAIL_BOUNCE_ADDRESS` | string | none | ZeptoMail bounce |
| `ZEPTOMAIL_URL` | string | none | ZeptoMail base URL |
| `MAILEROO_API_KEY` | string | none | Maileroo API key |
| `MAILEROO_FROM_EMAIL` | string | none | Maileroo sender |
| `MAILEROO_FROM_NAME` | string | none | Maileroo sender name |
| `MAILEROO_URL` | string | none | Maileroo base URL |
| `APP_BRAND_NAME` | string | `Your App` | Branding name |
| `APP_BRAND_PREFIX` | string | none | ID prefix for transactions |
| `APP_BASE_URL` | string | none | Base URL |
| `JWT_SECRET` | string | none | JWT signing key |
| `API_SECRET_ENC_KEY` | string | none | Merchant secret encryption key |
| `REDIS_URL` | string | none | Redis connection URI |
| `SUPER_ADMIN_IPS` | string | none | Super admin IPs |
| `SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED` | boolean | `false` | Enable admin IP whitelist |
| `RATE_LIMIT_MAX` | number | `100` | Rate limit max |
| `RATE_LIMIT_WINDOW` | number | `60` | Rate limit window seconds |
| `SYSTEM_TPS` | number | `100` | System TPS limit |
| `SYSTEM_TPS_WINDOW` | number | `1` | System TPS window seconds |
| `CRON_LEDGER_SEALER` | string | `*/5 * * * * *` | Ledger seal frequency |
| `CRON_LEDGER_SNAPSHOT` | string | `0 0 * * * *` | Ledger snapshot schedule |
| `CRON_LEDGER_INTEGRITY` | string | `0 0 */6 * * *` | Ledger integrity schedule |
| `CRON_LEDGER_OPTIMIZE` | string | `0 0 0 * * *` | Ledger optimize schedule |
| `CRON_LEDGER_EOD` | string | `0 30 23 * * *` | Ledger EOD rebuild |
| `CRON_PROVIDER_FEE_SETTLEMENT` | string | `0 0 1 * * *` | Provider fee settlement schedule |
| `CRON_SETTLEMENT_VERIFICATION` | string | `0 0 2 * * *` | Settlement verification schedule |
| `CRON_PAYIN_EXPIRY_SWEEP` | string | `0 */5 * * * *` | Payin expiry sweep |
| `REPORT_EMAIL_TRANSACTIONS_ENABLED` | boolean | `false` | Email transactions report |
| `REPORT_EMAIL_STATEMENT_ENABLED` | boolean | `true` | Email ledger statement |
| `REPORT_STORAGE_DIR` | string | `/data/reports` | Reports output dir |
| `AMOUNT_UNIT` | enum | `RUPEES` | Amount unit in storage |
| `PAYIN_AUTO_EXPIRE_MINUTES` | number | `30` | Auto‑expire pending payins |

---

End of Volume 10.


---
