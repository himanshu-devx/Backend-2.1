import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  code?: string;
  status: ContentfulStatusCode;
  details?: unknown;
  cause?: unknown;

  constructor(
    message: string,
    opts?: {
      code?: string;
      status?: ContentfulStatusCode;
      details?: unknown;
      cause?: unknown;
    }
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = "AppError";
    this.code = opts?.code;
    this.status = opts?.status ?? 400; // 400 is valid
    this.details = opts?.details;
    this.cause = opts?.cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export type HttpError = AppError | string;

// -------------------------
//     Error Shortcuts
// -------------------------

export const BadRequest = (message = "Bad request", details?: unknown) =>
  new AppError(message, {
    code: "BAD_REQUEST",
    status: 400,
    details,
  });

export const Unauthorized = (message = "Unauthorized", details?: unknown) =>
  new AppError(message, {
    code: "UNAUTHORIZED",
    status: 401,
    details,
  });

export const Forbidden = (message = "Forbidden", details?: unknown) =>
  new AppError(message, {
    code: "FORBIDDEN",
    status: 403,
    details,
  });

// ************************
//  THE ONES YOU REQUESTED
// ************************

export const NotFound = (message = "Resource not found", details?: unknown) =>
  new AppError(message, {
    code: "NOT_FOUND",
    status: 404,
    details,
  });

export const Conflict = (message = "Conflict", details?: unknown) =>
  new AppError(message, {
    code: "CONFLICT",
    status: 409,
    details,
  });

export const TooManyRequests = (
  message = "Too many requests",
  details?: unknown
) =>
  new AppError(message, {
    code: "TOO_MANY_REQUESTS",
    status: 429,
    details,
  });

export const PayloadTooLarge = (
  message = "Payload too large",
  details?: unknown
) =>
  new AppError(message, {
    code: "PAYLOAD_TOO_LARGE",
    status: 413,
    details,
  });

// ************************

export const InternalError = (
  message = "Internal server error",
  details?: unknown
) =>
  new AppError(message, {
    code: "INTERNAL_ERROR",
    status: 500,
    details,
  });
