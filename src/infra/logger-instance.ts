import { ENV } from "@/config/env";
import pino from "pino";

export function createLogger(serviceName: string) {
  const isDev = ENV.NODE_ENV !== "production";

  return pino({
    level: ENV.LOG_LEVEL || "info",
    base: { service: serviceName, env: ENV.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.Authorization",
        "req.headers.x-signature",
        "req.headers.x-api-key",
        "req.headers.x-merchant-id",
        "req.headers.cookie",
        "body.password",
        "body.apiSecret",
        "body.secret",
        "body.otp",
        "body.hash",
        "body.signature",
        "payload.password",
        "payload.apiSecret",
        "payload.secret",
        "payload.otp",
        "payload.hash",
        "payload.signature",
      ],
      censor: "[REDACTED]",
      remove: false,
    },
    transport: isDev
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  });
}

export const logger = createLogger(ENV.SERVICE_NAME || "api-service");
