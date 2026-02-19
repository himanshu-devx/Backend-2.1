import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";
import { AuditEvent } from "@/types/audit-log.types";

type AuditRecord = AuditEvent & {
  ts: string;
  prevHash?: string;
  hash: string;
};

export class AuditSink {
  private static initialized = false;
  private static lastHash: string | undefined;
  private static queue: Promise<void> = Promise.resolve();

  static async init() {
    if (this.initialized) return;
    this.initialized = true;

    if (!ENV.AUDIT_LOG_PATH) {
      logger.warn("Audit sink disabled: AUDIT_LOG_PATH is not set.");
      return;
    }

    const filePath = this.resolvePath(ENV.AUDIT_LOG_PATH);
    const dir = path.dirname(filePath);

    try {
      await fs.mkdir(dir, { recursive: true });
      const handle = await fs.open(filePath, "a", 0o600);
      await handle.close();
      this.lastHash = await this.loadLastHash(filePath);
    } catch (err) {
      logger.warn({ err }, "Audit sink init failed.");
    }
  }

  static async append(event: AuditEvent) {
    if (!ENV.AUDIT_LOG_PATH) return;
    if (!this.initialized) await this.init();

    this.queue = this.queue.then(async () => {
      const filePath = this.resolvePath(ENV.AUDIT_LOG_PATH);
      const record = this.buildRecord(event);
      const line = JSON.stringify(record) + "\n";

      try {
        await fs.appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
        this.lastHash = record.hash;
      } catch (err) {
        logger.warn({ err }, "Audit sink append failed.");
      }
    });

    return this.queue;
  }

  private static resolvePath(value: string) {
    return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
  }

  private static buildRecord(event: AuditEvent): AuditRecord {
    const ts = new Date().toISOString();
    const prevHash = this.lastHash;
    const payload = JSON.stringify({ ...event, ts, prevHash });
    const hash = this.computeHash(payload);

    return {
      ...event,
      ts,
      prevHash,
      hash,
    };
  }

  private static computeHash(payload: string) {
    if (ENV.AUDIT_HASH_KEY) {
      return crypto
        .createHmac("sha256", ENV.AUDIT_HASH_KEY)
        .update(payload)
        .digest("hex");
    }

    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  private static async loadLastHash(filePath: string) {
    try {
      const data = await fs.readFile(filePath, "utf8");
      if (!data.trim()) return undefined;
      const lines = data.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine) as { hash?: string };
      return parsed.hash;
    } catch {
      return undefined;
    }
  }
}
