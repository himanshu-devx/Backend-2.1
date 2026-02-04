// src/app.ts
// import "@/infra/otel-sdk"; // Moved to instances
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestLogger } from "./middlewares/request-logger";
import { traceContext } from "./middlewares/trace-id";
import { loggerContext } from "./middlewares/logger-context";
import { errorHandler } from "./middlewares/error-handler";
import { contextMiddleware } from "./middlewares/context";

import { safeBody } from "./middlewares/safe-body";
import { ENV } from "./config/env";

import { secureHeaders } from "hono/secure-headers";

export function buildApp(): Hono {
  const app = new Hono();

  // 1. Security Headers
  app.use("*", secureHeaders());

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (origin.startsWith("http://localhost:")) return origin;
        if (ENV.FRONTEND_URL && origin === ENV.FRONTEND_URL) return origin;
        return ENV.FRONTEND_URL || "*";
      },
      allowHeaders: ["Content-Type", "Authorization", "x-request-id", "x-merchant-id"],
      allowMethods: ["POST", "GET", "OPTIONS", "PATCH", "DELETE", "PUT"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    })
  );

  app.use("*", contextMiddleware());
  app.use("*", safeBody);
  app.use("*", traceContext);
  app.use("*", loggerContext);
  app.onError(errorHandler);
  app.use("*", requestLogger);

  // 404 Handler
  app.notFound((c) => {
    const method = c.req.method;
    const url = c.req.url;
    console.warn(`[404] Route not found: ${method} ${url}`);

    return c.json(
      {
        success: false,
        error: "Route not found",
        message: `No mount for ${method} ${c.req.path}. Did you forget the /api prefix?`,
        path: c.req.path,
      },
      404
    );
  });

  return app;
}
