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
    const resp: AxiosResponse = await axios.request(config);
    const rawBody = typeof resp.data === "string" ? resp.data : undefined;

    if (resp.status < 200 || resp.status >= 300) {
      const msg = `Provider HTTP ${resp.status} for ${req.method} ${req.url}`;
      logger.error(
        {
          ...req.context,
          status: resp.status,
          response: resp.data,
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
