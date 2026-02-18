// src/middlewares/logger-context.ts
import { logger as baseLogger } from "@/infra/logger-instance";
import type { MiddlewareHandler } from "hono";
import { sampleFromId, sampleRate } from "@/infra/log-sampling";

export const loggerContext: MiddlewareHandler = async (c, next) => {
  const traceId = c.get("traceId");
  const span = c.get("span");
  const spanId = span?.spanContext ? span.spanContext().spanId : undefined;
  const requestId = c.get("requestId");
  const correlationId = c.get("correlationId");
  const sampled = sampleFromId(requestId);
  const reqLogger = baseLogger.child({
    traceId,
    spanId,
    requestId,
    correlationId,
    sampled,
    sampleRate,
  });
  c.set("logger", reqLogger);
  c.set("logSampled", sampled);
  return next();
};
