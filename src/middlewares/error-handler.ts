// src/middlewares/error-handler.ts

import type { ErrorHandler } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { ENV } from "@/config/env";
import { AppError } from "@/utils/error";
import { SecurityEventService } from "@/services/common/security-event.service";

export const errorHandler: ErrorHandler = (e, c) => {
  const logger = c.get("logger");
  const isDev = ENV.NODE_ENV !== "production";
  const requestId = c.get("requestId");
  const correlationId = c.get("correlationId");
  const merchantId = c.get("merchantId") || c.get("merchant")?.id;
  const forwardedFor = c.req.header("x-forwarded-for");
  const forwardedIp = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : undefined;
  const userAgent = c.req.header("user-agent");
  const ip =
    c.get("requestIp") ||
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-real-ip") ||
    forwardedIp;

  if (e instanceof AppError) {
    logger.warn(
      {
        code: e.code,
        message: e.message,
        details: e.details,
        stack: isDev ? e.stack : undefined,
      },
      "app error"
    );

    if ([401, 403, 429].includes(e.status)) {
      void SecurityEventService.record({
        action: "SECURITY_ERROR",
        severity: e.status === 429 ? "MEDIUM" : "HIGH",
        ipAddress: ip,
        userAgent,
        requestId,
        correlationId,
        metadata: {
          status: e.status,
          code: e.code,
          message: e.message,
          path: c.req.path,
          method: c.req.method,
          merchantId,
        },
        source: "error-handler",
      });
    }

    const status: StatusCode = e.status ?? 400;

    return c.json(
      { success: false, error: e.message, code: e.code, details: e.details },
      status
    );
  }

  logger.error(e, "fatal error");
  // Fallback console log for safety in case of logger issues
  console.error("FATAL ERROR:", e);

  return c.json({ success: false, error: "Internal server error" }, 500);
};
