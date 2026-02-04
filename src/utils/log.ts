import { Context } from "hono";

export function log(c: Context) {
  return c.get("logger");
}
