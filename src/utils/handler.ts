// src/utils/handler.ts
import type { Context, Handler } from "hono";
import { Logger } from "pino";

export const handler = (
  fn: (c: Context, logger: Logger) => Promise<any> | any
): Handler => {
  return async (c: Context) => {
    const logger = c.get("logger");
    try {
      return await fn(c, logger);
    } catch (err) {
      throw err;
    }
  };
};
