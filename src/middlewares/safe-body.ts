import type { Context, Next } from "hono";

export const safeBody = async (c: Context, next: Next) => {
  try {
    const text = await c.req.text();
    c.set("raw_body", text);

    if (!text || !text.trim()) {
      c.set("body", {});
    } else {
      try {
        c.set("body", JSON.parse(text));
      } catch {
        c.set("body", {});
      }
    }
  } catch {
    c.set("body", {});
  }

  await next();
};
