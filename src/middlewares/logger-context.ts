// src/middlewares/logger-context.ts
import { logger as baseLogger } from "@/infra/logger-instance";
import type { MiddlewareHandler } from "hono";

export const loggerContext: MiddlewareHandler = async (c, next) => {
  const traceId = c.get("traceId");
  const reqLogger = baseLogger.child({ traceId });
  c.set("logger", reqLogger);
  return next();
};
