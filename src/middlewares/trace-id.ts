// src/middlewares/trace-id.ts
import type { MiddlewareHandler } from "hono";
import { trace } from "@opentelemetry/api";
import { setLogContext } from "@/infra/log-context";

export const traceContext: MiddlewareHandler = async (c, next) => {
  const tracer = trace.getTracer("service");
  return tracer.startActiveSpan(
    `HTTP ${c.req.method} ${c.req.path}`,
    async (span) => {
      c.set("span", span); // store full span also useful later
      const spanCtx = span.spanContext();
      c.set("traceId", spanCtx.traceId);
      c.set("spanId", spanCtx.spanId);
      setLogContext({ traceId: spanCtx.traceId, spanId: spanCtx.spanId });
      await next();
      span.end();
    }
  );
};
