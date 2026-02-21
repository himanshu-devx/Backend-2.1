// src/middlewares/logger-context.ts
import { logger as baseLogger } from "@/infra/logger-instance";
import type { MiddlewareHandler } from "hono";

export const loggerContext: MiddlewareHandler = async (c, next) => {
  const reqLogger = baseLogger.child({
    requestId: c.get("requestId"),
    correlationId: c.get("correlationId"),
    traceId: c.get("traceId"),
    spanId: c.get("spanId"),
  });
  c.set("logger", reqLogger);
  return next();
};
