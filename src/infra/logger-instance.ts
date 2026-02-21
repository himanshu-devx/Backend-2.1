import { ENV } from "@/config/env";
import { getLogContext } from "@/infra/log-context";
import os from "node:os";
import pino from "pino";

export function createLogger(serviceName: string) {
  const isDev = ENV.NODE_ENV !== "production";

  return pino({
    level: ENV.LOG_LEVEL || "info",
    base: {
      service: serviceName,
      pid: process.pid,
      hostname: os.hostname(),
      env: ENV.NODE_ENV,
    },
    mixin() {
      return getLogContext() || {};
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: isDev
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            singleLine: true,
          },
        }
      : undefined,
  });
}

export const logger = createLogger(ENV.SERVICE_NAME || "api-service");
