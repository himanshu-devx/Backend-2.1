// src/middlewares/trace-id.ts
import type { MiddlewareHandler } from "hono";
import { trace } from "@opentelemetry/api";

export const traceContext: MiddlewareHandler = async (c, next) => {
  const tracer = trace.getTracer("service");
  return tracer.startActiveSpan(
    `HTTP ${c.req.method} ${c.req.path}`,
    async (span) => {
      c.set("span", span); // store full span also useful later
      c.set("traceId", span.spanContext().traceId);
      await next();
      span.end();
    }
  );
};
