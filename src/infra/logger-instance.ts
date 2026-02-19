import { ENV } from "@/config/env";
import pino from "pino";

export function createLogger(serviceName: string) {
  const isDev = ENV.NODE_ENV !== "production";

  return pino({
    level: ENV.LOG_LEVEL || "info",
    base: { service: serviceName, env: ENV.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.Authorization",
        "req.headers.x-signature",
        "req.headers.x-api-key",
        "req.headers.x-merchant-id",
        "req.headers.x-timestamp",
        "req.headers.cookie",
        "req.headers.set-cookie",
        "body.password",
        "body.apiSecret",
        "body.secret",
        "body.otp",
        "body.token",
        "body.refreshToken",
        "body.pin",
        "body.pan",
        "body.cvv",
        "body.cvc",
        "body.hash",
        "body.signature",
        "body.customerEmail",
        "body.customerPhone",
        "body.beneficiaryAccountNumber",
        "body.beneficiaryIfsc",
        "body.beneficiaryPhone",
        "body.beneficiaryEmail",
        "body.accountNumber",
        "body.ifscCode",
        "body.upiId",
        "body.email",
        "body.phone",
        "body.bankAccountId",
        "body.party",
        "payload.password",
        "payload.apiSecret",
        "payload.secret",
        "payload.otp",
        "payload.token",
        "payload.refreshToken",
        "payload.pin",
        "payload.pan",
        "payload.cvv",
        "payload.cvc",
        "payload.hash",
        "payload.signature",
        "payload.customerEmail",
        "payload.customerPhone",
        "payload.beneficiaryAccountNumber",
        "payload.beneficiaryIfsc",
        "payload.beneficiaryPhone",
        "payload.beneficiaryEmail",
        "payload.accountNumber",
        "payload.ifscCode",
        "payload.upiId",
        "payload.email",
        "payload.phone",
        "payload.bankAccountId",
        "merchant.apiSecretEncrypted",
        "merchant.apiSecret",
        "merchant.password",
        "merchant.otp",
      ],
      censor: "[REDACTED]",
      remove: false,
    },
    transport: isDev
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  });
}

export const logger = createLogger(ENV.SERVICE_NAME || "api-service");
