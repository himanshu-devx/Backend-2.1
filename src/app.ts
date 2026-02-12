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

export type CorsMode = "api" | "payment";

const API_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-request-id",
  "x-correlation-id",
  "x-requested-with",
  "x-merchant-id",
  "x-timestamp",
  "x-signature",
];

const PAYMENT_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-request-id",
  "x-correlation-id",
  "x-merchant-id",
  "x-timestamp",
  "x-signature",
];

const ALLOW_METHODS = ["POST", "GET", "OPTIONS", "PATCH", "DELETE", "PUT"];

export function buildApp(corsMode: CorsMode = "api"): Hono {
  const app = new Hono();

  // 1. Security Headers
  app.use("*", secureHeaders());

  app.use(
    "*",
    cors({
      origin: (origin) => {
        console.log(`[CORS] Checking origin: ${origin}`);
        if (corsMode === "payment") return "*";
        if (!origin) return null;
        if (
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:") ||
          origin.startsWith("https://localhost:") ||
          origin === "http://localhost:3000"
        ) {
          return origin;
        }
        if (ENV.FRONTEND_URL && origin === ENV.FRONTEND_URL) return origin;
        return origin; // Temporary allowable for all for debugging if needed, but better to stick to logic.
      },
      allowHeaders: corsMode === "payment" ? PAYMENT_ALLOW_HEADERS : API_ALLOW_HEADERS,
      allowMethods: ALLOW_METHODS,
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: corsMode === "api",
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
