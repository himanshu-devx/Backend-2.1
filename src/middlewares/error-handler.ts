// src/middlewares/error-handler.ts

import type { ErrorHandler } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { ENV } from "@/config/env";
import { AppError } from "@/utils/error";

export const errorHandler: ErrorHandler = (e, c) => {
  const logger = c.get("logger");
  const isDev = ENV.NODE_ENV !== "production";

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
