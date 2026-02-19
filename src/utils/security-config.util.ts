import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";
import { SecurityEventService } from "@/services/common/security-event.service";

const DEFAULT_SNAPSHOT_PATH = "storage/security/security-config.json";

const hashValue = (value?: string) => {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(value).digest("hex");
};

const buildSnapshot = () => {
  const data = {
    NODE_ENV: ENV.NODE_ENV,
    ENCRYPT_PII: ENV.ENCRYPT_PII,
    API_SECRET_ENC_KEY_HASH: hashValue(ENV.API_SECRET_ENC_KEY),
    API_SECRET_ENC_KEYS_HASH: hashValue(ENV.API_SECRET_ENC_KEYS),
    JWT_SECRET_HASH: hashValue(ENV.JWT_SECRET),
    FRONTEND_URL: ENV.FRONTEND_URL,
    CORS_ALLOWED_ORIGINS: ENV.CORS_ALLOWED_ORIGINS,
    MAX_REQUEST_BODY_BYTES: ENV.MAX_REQUEST_BODY_BYTES,
    AUDIT_LOG_PATH: ENV.AUDIT_LOG_PATH,
  };

  const payload = JSON.stringify(data);
  const hash = crypto.createHash("sha256").update(payload).digest("hex");

  return { data, hash };
};

export const validateSecurityConfig = () => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (ENV.NODE_ENV === "production") {
    if (!ENV.ENCRYPT_PII) {
      errors.push("ENCRYPT_PII must be true in production.");
    }

    if (!ENV.API_SECRET_ENC_KEY) {
      errors.push("API_SECRET_ENC_KEY is required in production.");
    } else if (ENV.API_SECRET_ENC_KEY.length < 32) {
      errors.push("API_SECRET_ENC_KEY must be at least 32 characters.");
    }

    if (ENV.API_SECRET_ENC_KEY && ENV.JWT_SECRET) {
      if (ENV.API_SECRET_ENC_KEY === ENV.JWT_SECRET) {
        errors.push("API_SECRET_ENC_KEY must not match JWT_SECRET.");
      }
    }

    if (!ENV.FRONTEND_URL && !ENV.CORS_ALLOWED_ORIGINS) {
      errors.push(
        "CORS_ALLOWED_ORIGINS or FRONTEND_URL must be set in production."
      );
    }

    if (!ENV.AUDIT_LOG_PATH) {
      warnings.push("AUDIT_LOG_PATH is not set; audit logs are not persisted.");
    }
  } else {
    if (!ENV.API_SECRET_ENC_KEY) {
      warnings.push("API_SECRET_ENC_KEY is not set; secret encryption will fail.");
    }
  }

  if (errors.length > 0) {
    errors.forEach((message) => logger.error({ message }, "security config"));
    throw new Error(`Security configuration invalid: ${errors.join(" ")}`);
  }

  warnings.forEach((message) => logger.warn({ message }, "security config"));
};

export const recordSecurityConfigSnapshot = async () => {
  const snapshotPath = ENV.SECURITY_CONFIG_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
  const absolutePath = path.isAbsolute(snapshotPath)
    ? snapshotPath
    : path.join(process.cwd(), snapshotPath);
  const dir = path.dirname(absolutePath);

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    logger.warn({ err }, "security config: failed to create snapshot dir");
    return;
  }

  const snapshot = buildSnapshot();
  let previousHash: string | undefined;

  try {
    const existing = await fs.readFile(absolutePath, "utf8");
    const parsed = JSON.parse(existing) as { hash?: string };
    previousHash = parsed?.hash;
  } catch {
    previousHash = undefined;
  }

  if (previousHash && previousHash !== snapshot.hash) {
    await SecurityEventService.record({
      action: "SECURITY_CONFIG_CHANGED",
      severity: "HIGH",
      metadata: {
        previousHash,
        newHash: snapshot.hash,
        snapshotPath: absolutePath,
      },
      source: "startup",
    });
  }

  const payload = {
    ts: new Date().toISOString(),
    hash: snapshot.hash,
    data: snapshot.data,
  };

  try {
    await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2));
  } catch (err) {
    logger.warn({ err }, "security config: failed to write snapshot");
  }
};
