import { Context, Next } from "hono";
import { Forbidden } from "@/utils/error";
import { setLogContext } from "@/infra/log-context";

export const extractPaymentIp = async (c: Context, next: Next) => {
    let ip = c.req.header("cf-connecting-ip");

    if (!ip) {
        ip = c.req.header("x-real-ip");
    }

    if (!ip) {
        const forwarded = c.req.header("x-forwarded-for");
        if (forwarded) {
            ip = forwarded.split(",")[0].trim();
        }
    }

    if (!ip) {
        // Fallback for local development
        ip = "127.0.0.1";
    }

    if (!ip) {
        // Should actally never happen due to fallback, but keeping safety
        throw Forbidden("Access Denied: Unable to identify client IP");
    }

    c.set("requestIp", ip);
    setLogContext({ requestIp: ip });
    await next();
};
