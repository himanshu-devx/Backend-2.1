// src/middlewares/request-logger.ts
import type { MiddlewareHandler } from "hono";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const logger = c.get("logger");
  const start = performance.now();
  await next();
  const merchant = c.get("merchant");
  const merchantId =
    merchant?.id || c.get("merchantId") || c.req.header("x-merchant-id");
  const requestId = c.get("requestId");
  const correlationId = c.get("correlationId");
  const traceId = c.get("traceId");
  const span = c.get("span");
  const spanId = span?.spanContext ? span.spanContext().spanId : undefined;
  const ip = c.get("requestIp");
  const userAgent = c.req.header("user-agent");
  const contentLength = c.req.header("content-length");
  const responseLength = c.res.headers.get("content-length");
  const sampled = c.get("logSampled");
  if (!sampled && c.res.status < 500) {
    return;
  }
  logger.info({
    event: "http_request",
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Number((performance.now() - start).toFixed(1)),
    requestId,
    correlationId,
    traceId,
    spanId,
    merchantId,
    ip,
    userAgent,
    contentLength,
    responseLength,
  });
};
