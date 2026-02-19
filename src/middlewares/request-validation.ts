import type { MiddlewareHandler } from "hono";
import { ENV } from "@/config/env";
import { BadRequest, PayloadTooLarge } from "@/utils/error";

const isJsonContentType = (value: string) => {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("application/json") ||
    (lower.startsWith("application/") && lower.includes("+json"))
  );
};

export const requestValidation = (): MiddlewareHandler => async (c, next) => {
  const method = c.req.method.toUpperCase();

  if (method === "OPTIONS" || method === "HEAD") {
    await next();
    return;
  }

  const contentLengthHeader = c.req.header("content-length");
  const transferEncoding = c.req.header("transfer-encoding");
  const contentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : undefined;

  if (contentLength && Number.isFinite(contentLength)) {
    if (contentLength > ENV.MAX_REQUEST_BODY_BYTES) {
      throw PayloadTooLarge(
        `Payload exceeds ${ENV.MAX_REQUEST_BODY_BYTES} bytes.`
      );
    }
  }

  const expectsBody = ["POST", "PUT", "PATCH"].includes(method);
  const hasBody =
    (contentLength !== undefined && contentLength > 0) ||
    transferEncoding?.toLowerCase() === "chunked";

  if (expectsBody && hasBody) {
    const contentType = c.req.header("content-type");
    if (!contentType) {
      throw BadRequest("Missing Content-Type header.");
    }
    if (!isJsonContentType(contentType)) {
      throw BadRequest("Unsupported Content-Type. Expected application/json.");
    }
  }

  await next();
};
