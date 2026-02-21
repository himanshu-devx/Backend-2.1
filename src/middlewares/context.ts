// src/middleware/context.ts
import { v4 as uuidv4 } from "uuid";
import { runWithLogContext } from "@/infra/log-context";

export function contextMiddleware() {
  return async (c: any, next: any) => {
    const req = c.req;
    const requestId = req.header("x-request-id") ?? uuidv4();
    const correlationId = req.header("x-correlation-id") ?? requestId;
    c.set("requestId", requestId);
    c.set("correlationId", correlationId);

    // set response headers
    c.res.headers.set("x-request-id", requestId);
    c.res.headers.set("x-correlation-id", correlationId);

    return runWithLogContext({ requestId, correlationId }, async () => {
      await next();
    });
  };
}
