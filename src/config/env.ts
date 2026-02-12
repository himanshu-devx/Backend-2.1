import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PAYMENT_PORT: z.coerce.number().default(4001),
  LOG_LEVEL: z.string().default("info"),
  SERVICE_NAME: z.string().default("app-service"),
  MONGODB_URI: z.string().startsWith("mongodb"),
  MONGO_DB_NAME: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  OTLP_HTTP_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),

  // Postgres
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.string().default("5435"),
  POSTGRES_USER: z.string().default("postgres"),
  POSTGRES_PASSWORD: z.string().default("password"),
  POSTGRES_DB: z.string().default("app_ledger"),
  POSTGRES_POOL_MAX: z.string().default("20"),

  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean().default(false)),
  MAIL_FROM_EMAIL: z.string().email().optional(),
  MAIL_FROM_NAME: z.string().optional(),
  ZEPTOMAIL_API_KEY: z.string().optional(),
  ZEPTOMAIL_FROM_EMAIL: z.string().email().optional(),
  ZEPTOMAIL_FROM_NAME: z.string().optional(),
  ZEPTOMAIL_BOUNCE_ADDRESS: z.string().optional(),
  ZEPTOMAIL_URL: z.string().url().optional(),

  APP_BRAND_NAME: z.string().default("Your App"),
  APP_BRAND_PREFIX: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(1),
  API_SECRET_ENC_KEY: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  SUPER_ADMIN_IPS: z.string().optional(),

  // FIXED
  SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(false)
  ),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60),
  SYSTEM_TPS: z.coerce.number().default(100),
  SYSTEM_TPS_WINDOW: z.coerce.number().default(1),

  // Ledger Cron Jobs
  CRON_LEDGER_SEALER: z.string().default("*/5 * * * * *"),
  CRON_LEDGER_SNAPSHOT: z.string().default("0 0 * * * *"),
  CRON_LEDGER_INTEGRITY: z.string().default("0 0 */6 * * *"),
  CRON_LEDGER_OPTIMIZE: z.string().default("0 0 0 * * *"),
  CRON_LEDGER_EOD: z.string().default("0 30 23 * * *"),
  CRON_PROVIDER_FEE_SETTLEMENT: z.string().default("0 0 1 * * *"),
  CRON_SETTLEMENT_VERIFICATION: z.string().default("0 0 2 * * *"),
  REPORT_EMAIL_TRANSACTIONS_ENABLED: z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean().default(false)),
  REPORT_EMAIL_STATEMENT_ENABLED: z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean().default(true)),
  REPORT_STORAGE_DIR: z.string().default("/data/reports"),
  AMOUNT_UNIT: z.enum(["PAISE", "RUPEES"]).default("RUPEES"),


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

  // Postgres
  POSTGRES_HOST: process.env.POSTGRES_HOST,
  POSTGRES_PORT: process.env.POSTGRES_PORT,
  POSTGRES_USER: process.env.POSTGRES_USER,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
  POSTGRES_DB: process.env.POSTGRES_DB,
  POSTGRES_POOL_MAX: process.env.POSTGRES_POOL_MAX,

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_SECURE: process.env.SMTP_SECURE,
  MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL,
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
  ZEPTOMAIL_API_KEY: process.env.ZEPTOMAIL_API_KEY,
  ZEPTOMAIL_FROM_EMAIL: process.env.ZEPTOMAIL_FROM_EMAIL,
  ZEPTOMAIL_FROM_NAME: process.env.ZEPTOMAIL_FROM_NAME,
  ZEPTOMAIL_BOUNCE_ADDRESS: process.env.ZEPTOMAIL_BOUNCE_ADDRESS,
  ZEPTOMAIL_URL: process.env.ZEPTOMAIL_URL,

  APP_BRAND_NAME: process.env.APP_BRAND_NAME,
  APP_BASE_URL: process.env.APP_BASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  API_SECRET_ENC_KEY: process.env.API_SECRET_ENC_KEY,
  REDIS_URL: process.env.REDIS_URL,
  SUPER_ADMIN_IPS: process.env.SUPER_ADMIN_IPS,
  SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED:
    process.env.SUPER_ADMIN_PANEL_IP_WHITELIST_ENABLED,
  RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW,
  SYSTEM_TPS: process.env.SYSTEM_TPS,
  SYSTEM_TPS_WINDOW: process.env.SYSTEM_TPS_WINDOW,
  PAYMENT_PORT: process.env.PAYMENT_PORT || 3001,
  APP_BRAND_PREFIX: process.env.APP_BRAND_PREFIX,

  // Ledger Cron Jobs
  CRON_LEDGER_SEALER: process.env.CRON_LEDGER_SEALER,
  CRON_LEDGER_SNAPSHOT: process.env.CRON_LEDGER_SNAPSHOT,
  CRON_LEDGER_INTEGRITY: process.env.CRON_LEDGER_INTEGRITY,
  CRON_LEDGER_OPTIMIZE: process.env.CRON_LEDGER_OPTIMIZE,
  CRON_LEDGER_EOD: process.env.CRON_LEDGER_EOD,
  CRON_PROVIDER_FEE_SETTLEMENT: process.env.CRON_PROVIDER_FEE_SETTLEMENT,
  CRON_SETTLEMENT_VERIFICATION: process.env.CRON_SETTLEMENT_VERIFICATION,
  REPORT_EMAIL_TRANSACTIONS_ENABLED: process.env.REPORT_EMAIL_TRANSACTIONS_ENABLED,
  REPORT_EMAIL_STATEMENT_ENABLED: process.env.REPORT_EMAIL_STATEMENT_ENABLED,
  REPORT_STORAGE_DIR: process.env.REPORT_STORAGE_DIR,
  AMOUNT_UNIT: process.env.AMOUNT_UNIT,

});
