import type { Context, Next } from "hono";
import { ENV } from "@/config/env";
import { PayloadTooLarge } from "@/utils/error";

export const safeBody = async (c: Context, next: Next) => {
  let text = "";
  try {
    text = await c.req.text();
  } catch {
    c.set("body", {});
    c.set("bodyParseError", true);
    await next();
    return;
  }

  c.set("rawBody", text);

  if (text.length > ENV.MAX_REQUEST_BODY_BYTES) {
    throw PayloadTooLarge(
      `Payload exceeds ${ENV.MAX_REQUEST_BODY_BYTES} bytes.`
    );
  }

  if (!text || !text.trim()) {
    c.set("body", {});
    c.set("bodyParseError", false);
  } else {
    try {
      c.set("body", JSON.parse(text));
      c.set("bodyParseError", false);
    } catch {
      c.set("body", {});
      c.set("bodyParseError", true);
    }
  }

  await next();
};
