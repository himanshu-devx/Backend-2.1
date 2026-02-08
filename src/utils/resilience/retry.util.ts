import { TimeoutError } from "./timeout.util";

export type RetryOptions = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  retryOn?: (err: any) => boolean;
};

export const isRetryableError = (err: any): boolean => {
  if (!err) return false;
  if (err instanceof TimeoutError) return true;
  const code = err.code || err.name;
  if (["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND"].includes(code)) {
    return true;
  }
  const msg = String(err.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("temporarily")) return true;
  const status = err.response?.status;
  if (status && status >= 500) return true;
  return false;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const shouldRetry = options.retryOn
        ? options.retryOn(err)
        : isRetryableError(err);
      if (!shouldRetry || attempt >= options.retries) {
        throw err;
      }

      const exp = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * Math.pow(2, attempt)
      );
      const jitter =
        exp * options.jitter * (Math.random() * 2 - 1); // +/- jitter
      const delay = Math.max(0, exp + jitter);

      attempt += 1;
      await sleep(delay);
    }
  }
}
