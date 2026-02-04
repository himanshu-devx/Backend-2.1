import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PAYMENT_PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),
  SERVICE_NAME: z.string().default("fintech-service"),
  MONGODB_URI: z.string().startsWith("mongodb"),
  MONGO_DB_NAME: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  WORKER_TZ: z.string().default("UTC"),
  OTLP_HTTP_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),

  // TigerBeetle (Legacy - being replaced by PostgreSQL Ledger)
  TIGERBEETLE_CLUSTER_ID: z.coerce.number().default(0),
  TIGERBEETLE_REPLICA_ADDRESSES: z.string().default("3000"), // Comma separated

  // PostgreSQL Ledger Database
  POSTGRES_LEDGER_URL: z.string().url().default("postgresql://localhost:5432/fintech_ledger"),
  POSTGRES_POOL_SIZE: z.coerce.number().default(20),

  // Worker Configuration
  WORKER_PORT: z.coerce.number().default(4001),
  WORKER_CONCURRENCY: z.coerce.number().default(5),

  // Cron Job Configuration
  CRON_SETTLEMENT_ENABLED: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(true)
  ),
  CRON_RECONCILIATION_ENABLED: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(true)
  ),
  CRON_SNAPSHOT_ENABLED: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(true)
  ),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),

  // FIXED
  SMTP_SECURE: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(false)
  ),

  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),

  // Zoho Mail API
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_REFRESH_TOKEN: z.string().optional(),
  ZOHO_FROM_EMAIL: z.string().optional(),
  ZOHO_ACCOUNT_ID: z.string().optional(),
  // SendGrid Name
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().optional(),
  ZOHO_OAUTH_DOMAIN: z.string().default("https://accounts.zoho.in"),
  ZOHO_MAIL_API_URL: z.string().url().default("https://mail.zoho.in/api/accounts"),
  // Zoho Mail API (Deprecated but kept for rollback)
  ZOHO_API_DOMAIN: z.string().default("https://mail.zoho.in"),

  APP_BRAND_NAME: z.string().default("Fintech App"),
  APP_BRAND_PREFIX: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(1),
  REDIS_URL: z.string().url().optional(),
  SUPER_ADMIN_IPS: z.string().optional(),

  // FIXED
  SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(false)
  ),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60),
});

export type Env = z.infer<typeof schema>;

export const ENV: Env = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL,
  SERVICE_NAME: process.env.SERVICE_NAME,
  MONGODB_URI: process.env.MONGODB_URI,
  MONGO_DB_NAME: process.env.MONGO_DB_NAME,
  API_PORT: process.env.API_PORT,
  WORKER_TZ: process.env.WORKER_TZ,
  OTLP_HTTP_URL: process.env.OTLP_HTTP_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,

  TIGERBEETLE_CLUSTER_ID: process.env.TIGERBEETLE_CLUSTER_ID,
  TIGERBEETLE_REPLICA_ADDRESSES: process.env.TIGERBEETLE_REPLICA_ADDRESSES,

  POSTGRES_LEDGER_URL: process.env.POSTGRES_LEDGER_URL,
  POSTGRES_POOL_SIZE: process.env.POSTGRES_POOL_SIZE,

  WORKER_PORT: process.env.WORKER_PORT,
  WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,

  CRON_SETTLEMENT_ENABLED: process.env.CRON_SETTLEMENT_ENABLED,
  CRON_RECONCILIATION_ENABLED: process.env.CRON_RECONCILIATION_ENABLED,
  CRON_SNAPSHOT_ENABLED: process.env.CRON_SNAPSHOT_ENABLED,

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,

  ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID,
  ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
  ZOHO_REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
  ZOHO_FROM_EMAIL: process.env.ZOHO_FROM_EMAIL,
  ZOHO_ACCOUNT_ID: process.env.ZOHO_ACCOUNT_ID,

  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL,

  ZOHO_OAUTH_DOMAIN: process.env.ZOHO_OAUTH_DOMAIN,
  ZOHO_MAIL_API_URL: process.env.ZOHO_MAIL_API_URL,
  ZOHO_API_DOMAIN: process.env.ZOHO_API_DOMAIN,

  APP_BRAND_NAME: process.env.APP_BRAND_NAME,
  APP_BASE_URL: process.env.APP_BASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  REDIS_URL: process.env.REDIS_URL,
  SUPER_ADMIN_IPS: process.env.SUPER_ADMIN_IPS,
  SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED:
    process.env.SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED,
  RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW,
  PAYMENT_PORT: process.env.PAYMENT_PORT || 3001,
  APP_BRAND_PREFIX: process.env.APP_BRAND_PREFIX,
});
