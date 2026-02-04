import { ENV } from "@/config/env";
import pino from "pino";

export function createLogger(serviceName: string) {
  const isDev = ENV.NODE_ENV !== "production";

  return pino({
    level: ENV.LOG_LEVEL || "info",
    base: { service: serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: isDev
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  });
}

export const logger = createLogger(ENV.SERVICE_NAME || "api-service");
