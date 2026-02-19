import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { logger } from "@/infra/logger-instance";

export type ProviderHttpResponse<T = any> = {
  status: number;
  data: T;
  headers: Record<string, string | string[] | undefined | null>;
  rawBody?: string;
};

export type ProviderHttpRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  data?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  responseType?: "json" | "text";
  context?: {
    providerId?: string;
    transactionId?: string;
    orderId?: string;
    action?: string;
  };
};

export class ProviderRequestError extends Error {
  status?: number;
  response?: any;
  headers?: Record<string, string | string[] | undefined | null>;

  constructor(
    message: string,
    status?: number,
    response?: any,
    headers?: Record<string, string | string[] | undefined | null>
  ) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.response = response;
    this.headers = headers;
  }
}

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "apisecret",
  "api_secret",
  "apisalt",
  "api_salt",
  "apitoken",
  "api_token",
  "token",
  "secret",
  "signature",
  "hash",
  "authorization",
  "x-signature",
  "x-api-key",
]);

const isSensitiveKey = (key: string) =>
  SENSITIVE_KEYS.has(key.toLowerCase());

const redactValue = (value: any) => {
  if (value === undefined || value === null) return value;
  return "***";
};

const redactObject = (input: any): any => {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(redactObject);
  if (typeof input !== "object") return input;

  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveKey(key)) {
      output[key] = redactValue(value);
    } else {
      output[key] = redactObject(value);
    }
  }
  return output;
};

const redactPayload = (data: any, headers?: Record<string, string>) => {
  if (data === undefined || data === null) return data;

  if (typeof data === "string") {
    const contentType = headers?.["Content-Type"] || headers?.["content-type"];
    if (contentType && contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(data);
      const obj: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        obj[key] = isSensitiveKey(key) ? "***" : value;
      }
      return obj;
    }
    try {
      const parsed = JSON.parse(data);
      return redactObject(parsed);
    } catch {
      return data.length > 1000 ? `[raw:${data.length} chars]` : data;
    }
  }

  return redactObject(data);
};

export async function providerRequest<T = any>(
  req: ProviderHttpRequest
): Promise<ProviderHttpResponse<T>> {
  const config: AxiosRequestConfig = {
    method: req.method,
    url: req.url,
    data: req.data,
    headers: req.headers,
    timeout: req.timeoutMs ?? 10000,
    responseType: req.responseType === "text" ? "text" : "json",
    transformResponse:
      req.responseType === "text" ? [(data) => data] : undefined,
    validateStatus: () => true,
  };

  try {
    logger.info(
      {
        ...req.context,
        method: req.method,
        url: req.url,
        headers: redactObject(req.headers || {}),
        data: redactPayload(req.data, req.headers),
      },
      "[ProviderHTTP] Request"
    );

    const resp: AxiosResponse = await axios.request(config);
    const rawBody = typeof resp.data === "string" ? resp.data : undefined;

    logger.info(
      {
        ...req.context,
        method: req.method,
        url: req.url,
        status: resp.status,
        headers: redactObject(resp.headers as Record<string, any>),
        data: redactPayload(resp.data),
      },
      "[ProviderHTTP] Response"
    );

    if (resp.status < 200 || resp.status >= 300) {
      const msg = `Provider HTTP ${resp.status} for ${req.method} ${req.url}`;
      logger.error(
        {
          ...req.context,
          status: resp.status,
          response: redactPayload(resp.data),
        },
        msg
      );
      throw new ProviderRequestError(
        msg,
        resp.status,
        resp.data,
        resp.headers as Record<string, string | string[] | undefined | null>
      );
    }

    return {
      status: resp.status,
      data: resp.data as T,
      headers: resp.headers as Record<string, string | string[] | undefined | null>,
      rawBody,
    };
  } catch (error: any) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }

    const msg = `Provider request failed: ${error?.message || "unknown error"}`;
    logger.error(
      {
        ...req.context,
        error: error?.message,
      },
      msg
    );
    throw new ProviderRequestError(msg);
  }
}
