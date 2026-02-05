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
  OTLP_HTTP_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),

  // Postgres
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.string().default("5435"),
  POSTGRES_USER: z.string().default("postgres"),
  POSTGRES_PASSWORD: z.string().default("password"),
  POSTGRES_DB: z.string().default("wisipay_ledger"),
  POSTGRES_POOL_MAX: z.string().default("20"),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),

  // FIXED
  SMTP_SECURE: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(false)
  ),

  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),

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

  // Postgres
  POSTGRES_HOST: process.env.POSTGRES_HOST,
  POSTGRES_PORT: process.env.POSTGRES_PORT,
  POSTGRES_USER: process.env.POSTGRES_USER,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
  POSTGRES_DB: process.env.POSTGRES_DB,
  POSTGRES_POOL_MAX: process.env.POSTGRES_POOL_MAX,

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,

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
