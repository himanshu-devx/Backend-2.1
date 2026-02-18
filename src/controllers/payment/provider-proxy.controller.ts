import { Context } from "hono";
import axios, { AxiosRequestConfig } from "axios";
import { logger as baseLogger } from "@/infra/logger-instance";
import { BadRequest, InternalError } from "@/utils/error";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_LOG_CHARS = 5000;

type NormalizedProxyRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  data?: any;
  timeoutMs?: number;
  responseType?: "json" | "text";
};

function tokenizeCurl(command: string): string[] {
  const tokens = command.match(/'[^']*'|"[^"]*"|\\S+/g) || [];
  return tokens.map((token) => {
    if (
      (token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith("\"") && token.endsWith("\""))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function parseCurlHeader(line: string): [string, string] | null {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (!key) return null;
  return [key, value];
}

function parseCurlCommand(command: string): NormalizedProxyRequest {
  const args = tokenizeCurl(command.trim());
  if (!args.length || args[0] !== "curl") {
    throw BadRequest("Curl command must start with 'curl'");
  }

  let method: NormalizedProxyRequest["method"] = "GET";
  let url = "";
  const headers: Record<string, string> = {};
  const dataParts: string[] = [];

  const consumeValue = (token: string, next?: string) => {
    if (token.includes("=")) {
      return token.split(/=(.*)/, 2)[1] || "";
    }
    return next || "";
  };

  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];

    if (token === "-X" || token === "--request") {
      const value = args[i + 1];
      if (value) {
        method = value.toUpperCase() as NormalizedProxyRequest["method"];
        i += 1;
      }
      continue;
    }

    if (token.startsWith("-X") && token.length > 2) {
      method = token.slice(2).toUpperCase() as NormalizedProxyRequest["method"];
      continue;
    }

    if (token === "-H" || token === "--header") {
      const value = args[i + 1];
      if (value) {
        const parsed = parseCurlHeader(value);
        if (parsed) headers[parsed[0]] = parsed[1];
        i += 1;
      }
      continue;
    }

    if ((token.startsWith("-H") || token.startsWith("--header=")) && token.length > 2) {
      const value = token.startsWith("-H") ? token.slice(2) : token.split(/=(.*)/, 2)[1] || "";
      const parsed = parseCurlHeader(value);
      if (parsed) headers[parsed[0]] = parsed[1];
      continue;
    }

    if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary" ||
      token === "--data-urlencode"
    ) {
      const value = args[i + 1];
      if (value !== undefined) {
        dataParts.push(value);
        i += 1;
      }
      continue;
    }

    if (
      token.startsWith("-d") ||
      token.startsWith("--data=") ||
      token.startsWith("--data-raw=") ||
      token.startsWith("--data-binary=") ||
      token.startsWith("--data-urlencode=")
    ) {
      const value = consumeValue(token, args[i + 1]);
      if (value) dataParts.push(value);
      continue;
    }

    if (token === "--url") {
      const value = args[i + 1];
      if (value) {
        url = value;
        i += 1;
      }
      continue;
    }

    if (token.startsWith("--url=")) {
      url = token.split(/=(.*)/, 2)[1] || "";
      continue;
    }

    if (token.startsWith("http://") || token.startsWith("https://")) {
      if (!url) url = token;
      continue;
    }

    // Ignore flags like -L/--location, --compressed, etc.
  }

  if (!url) {
    throw BadRequest("Curl command missing URL");
  }

  let data: any = undefined;
  if (dataParts.length) {
    const bodyStr = dataParts.join("&");
    const trimmed = bodyStr.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        data = bodyStr;
      }
    } else {
      data = bodyStr;
    }

    if (method === "GET") method = "POST";
  }

  return {
    method,
    url,
    headers: Object.keys(headers).length ? headers : undefined,
    data,
  };
}

function normalizeHeaders(headers: any): Record<string, string> | undefined {
  if (!headers) return undefined;

  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const h of headers) {
      if (!h) continue;
      if (h.disabled) continue;
      const key = String(h.key || h.name || "").trim();
      if (!key) continue;
      const value = h.value ?? h.val ?? "";
      out[key] = String(value);
    }
    return Object.keys(out).length ? out : undefined;
  }

  if (typeof headers === "object") {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!key) continue;
      if (value === undefined || value === null) continue;
      out[key] = String(value);
    }
    return Object.keys(out).length ? out : undefined;
  }

  return undefined;
}

function normalizeBody(body: any): any {
  if (body === undefined || body === null) return undefined;

  if (typeof body === "object") {
    if (typeof body.raw === "string") return body.raw;
    if (body.mode === "raw" && typeof body.raw === "string") return body.raw;
  }

  return body;
}

function normalizeUrl(rawUrl: any): string {
  if (typeof rawUrl === "string") return rawUrl.trim();
  if (!rawUrl || typeof rawUrl !== "object") return "";

  const candidate =
    rawUrl.raw ||
    rawUrl.url ||
    rawUrl.href ||
    (typeof rawUrl.toString === "function" ? rawUrl.toString() : "");

  return typeof candidate === "string" ? candidate.trim() : "";
}

function normalizeProxyRequest(payload: any): NormalizedProxyRequest {
  if (!payload || typeof payload !== "object") {
    throw BadRequest("Request body must be JSON or a curl command");
  }

  const root = payload || {};
  const request = root.request || root;

  const methodRaw = String(request.method || root.method || "POST").toUpperCase();
  if (!ALLOWED_METHODS.has(methodRaw)) {
    throw BadRequest(`Invalid method: ${methodRaw}`);
  }

  const url = normalizeUrl(request.url ?? root.url);
  if (!url) throw BadRequest("Missing request url");

  const headers = normalizeHeaders(request.headers ?? request.header ?? root.headers ?? root.header);
  const data = normalizeBody(request.body ?? root.body ?? root.data);

  const timeoutValue = request.timeoutMs ?? root.timeoutMs ?? request.timeout ?? root.timeout;
  const timeoutMs = typeof timeoutValue === "number" && Number.isFinite(timeoutValue)
    ? timeoutValue
    : undefined;

  const responseType = (request.responseType ?? root.responseType) as "json" | "text" | undefined;

  return {
    method: methodRaw as NormalizedProxyRequest["method"],
    url,
    headers,
    data,
    timeoutMs,
    responseType,
  };
}

function redactHeaders(headers?: Record<string, string>) {
  if (!headers) return undefined;
  const redacted = { ...headers };
  const keys = Object.keys(redacted);
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (
      lower.includes("authorization") ||
      lower.includes("api-key") ||
      lower.includes("apikey") ||
      lower.includes("token") ||
      lower.includes("secret")
    ) {
      redacted[key] = "[REDACTED]";
    }
  }
  return redacted;
}

function safeStringify(value: any): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: any, maxChars = MAX_LOG_CHARS): string {
  const str = safeStringify(value);
  if (str.length <= maxChars) return str;
  return `${str.slice(0, maxChars)}...[truncated ${str.length - maxChars} chars]`;
}

export class ProviderProxyController {
  static async proxy(c: Context) {
    const logger = (c.get("logger") as typeof baseLogger) || baseLogger;
    const rawText = (c.get("raw_body") as string | undefined) ?? (await c.req.text());
    const trimmed = rawText ? rawText.trim() : "";

    let payload: any = c.get("validatedBody") || c.get("body");
    let normalized: NormalizedProxyRequest | null = null;

    if (trimmed) {
      if (trimmed.startsWith("curl ")) {
        normalized = parseCurlCommand(trimmed);
      } else {
        try {
          payload = JSON.parse(trimmed);
        } catch {
          payload = trimmed;
        }
      }
    }

    if (!normalized) {
      if (payload && typeof payload === "object") {
        const curlText = typeof payload.curl === "string" ? payload.curl : undefined;
        if (curlText) {
          normalized = parseCurlCommand(curlText);
        }
      }
    }

    if (!normalized) {
      normalized = normalizeProxyRequest(payload);
    }

    const requestConfig: AxiosRequestConfig = {
      method: normalized.method,
      url: normalized.url,
      headers: normalized.headers,
      data: normalized.data,
      timeout: normalized.timeoutMs ?? 15000,
      responseType: "text",
      transformResponse: [(data) => data],
      validateStatus: () => true,
    };

    const start = Date.now();

    try {
      const resp = await axios.request(requestConfig);
      const durationMs = Date.now() - start;
      const contentType = String(resp.headers?.["content-type"] || "").toLowerCase();

      let responseData: any = resp.data;
      if (normalized.responseType !== "text" && contentType.includes("application/json")) {
        try {
          responseData = JSON.parse(String(resp.data));
        } catch {
          responseData = resp.data;
        }
      }

      logger.info(
        {
          method: normalized.method,
          url: normalized.url,
          status: resp.status,
          durationMs,
          requestHeaders: redactHeaders(normalized.headers),
          responseHeaders: resp.headers,
          responseBody: truncate(responseData),
        },
        "[ProviderProxy] Response"
      );

      const ok = resp.status >= 200 && resp.status < 300;

      return c.json({
        success: ok,
        data: {
          status: resp.status,
          headers: resp.headers,
          durationMs,
          body: responseData,
        },
      });
    } catch (error: any) {
      const durationMs = Date.now() - start;
      logger.error(
        {
          method: normalized.method,
          url: normalized.url,
          durationMs,
          requestHeaders: redactHeaders(normalized.headers),
          error: error?.message,
        },
        "[ProviderProxy] Request failed"
      );

      throw InternalError(error?.message || "Provider request failed");
    }
  }
}
