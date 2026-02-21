// src/middlewares/request-logger.ts
import type { MiddlewareHandler } from "hono";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const logger = c.get("logger");
  const start = performance.now();
  await next();
  logger.info({
    event: "http.request",
    component: "api",
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: Number((performance.now() - start).toFixed(1)),
  });
};
