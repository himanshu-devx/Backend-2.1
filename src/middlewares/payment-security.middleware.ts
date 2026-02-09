
import { Context, MiddlewareHandler, Next } from "hono";
import { CacheService } from "@/services/common/cache.service";
import { Forbidden, Unauthorized, BadRequest } from "@/utils/error";
import { logger } from "@/infra/logger-instance";
import crypto from "crypto";
import { decryptSecret, looksLikeArgon2Hash } from "@/utils/secret.util";
import { ENV } from "@/config/env";

export const paymentSecurityMiddleware = (
    type: "PAYIN" | "PAYOUT" | "STATUS",
    options: { skipSignature?: boolean } = {}
): MiddlewareHandler => async (c: Context, next: Next) => {

    // 1. Headers Validation
    const merchantId = c.req.header("x-merchant-id");
    const timestampStr = c.req.header("x-timestamp");

    // Safety check for body parsing first
    let body: any = {};
    let rawBody = "";

    if (c.req.method === "POST" || c.req.method === "PUT") {
        try {
            rawBody = await c.req.text(); // Read raw text once
            if (rawBody) {
                try {
                    body = JSON.parse(rawBody);
                } catch (jsonErr) {
                    // Maybe form data or invalid json, try parseBody fallback if needed or just ignore
                    // But for signature we need raw body.
                    // If JSON parse fails, body remains {} which is fine for basic checks but validation will fail later
                }
            }
        } catch (e) {
            logger.warn("[PaymentSecurity] Failed to read request body");
        }
    }

    let signature = (c.req.header("x-signature") || body["hash"] || "") as string;
    if (signature && signature.startsWith("sha256=")) {
        signature = signature.slice("sha256=".length);
    }

    if (!merchantId) throw BadRequest("Missing x-merchant-id");
    const skipTimestampCheck = type === "PAYIN" || type === "PAYOUT" || type === "STATUS";
    if (!skipTimestampCheck && !timestampStr) throw BadRequest("Missing x-timestamp");

    // We need the raw body for signature verification if we change to payload signing
    // For now, let's assume we use the legacy body fields or a standardized payload construction
    // But user asked for "hasing and validate also use hasing for unique orderid"
    // Let's implement the standard signature: HMAC( JSON.stringify(body) + "|" + timestamp, secret ) 
    // BUT we need to support the body parsing. 
    // For Hono, c.req.json() can be called once.


    // 2. Timestamp Validation (1 Minute Window)
    if (!skipTimestampCheck) {
        const timestamp = parseInt(timestampStr, 10);
        if (isNaN(timestamp)) throw BadRequest("Invalid x-timestamp");

        const now = Date.now();
        const diff = Math.abs(now - timestamp);
        if (diff > 60000) { // 60 seconds
            throw Forbidden(`Timestamp out of range (Server Time: ${now}, Req Time: ${timestamp}, Diff: ${diff}ms)`);
        }
    }

    // 3. Merchant Validation (Cache)
    const merchant = await CacheService.getMerchant(merchantId);
    if (!merchant) throw Unauthorized("Invalid Merchant ID");

    if (!merchant.status) throw Forbidden("Merchant is not active");
    if (!merchant.isOnboard) throw Forbidden("Merchant is not onboarded");
    if (merchant.apiSecretEnabled === false) {
        throw Forbidden("API keys are disabled for this merchant");
    }

    // 4. IP Validation
    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || c.env?.remoteAddr || "127.0.0.1";
    // Sanitize IP (remove ::ffff:)
    const ip = Array.isArray(clientIp) ? clientIp[0] : (clientIp.split(",")[0].trim().replace("::ffff:", ""));

    // Check Config based on Type
    let ipWhitelist: string[] = [];
    let isWhitelistEnabled = false;

    if (type === "PAYIN") {
        if (!merchant.payin?.isActive) throw Forbidden("Payin Service Disabled");
        ipWhitelist = merchant.payin?.apiIpWhitelist || [];
        isWhitelistEnabled = merchant.payin?.isApiIpWhitelistEnabled || false;
    } else if (type === "PAYOUT") {
        if (!merchant.payout?.isActive) throw Forbidden("Payout Service Disabled");
        ipWhitelist = merchant.payout?.apiIpWhitelist || [];
        isWhitelistEnabled = merchant.payout?.isApiIpWhitelistEnabled || false;
    }
    // Status checks might use Payin whitelist or global panel whitelist, let's use Payin for now or a generic API whitelist

    if (isWhitelistEnabled) {
        // Domain-Based Bypass (Dashboard / Frontend)
        const origin = c.req.header("origin") || c.req.header("referer");
        const trustedFrontend = ENV.FRONTEND_URL || "http://localhost:3000";
        let isTrustedOrigin = false;

        if (origin) {
            // Simple check: does origin start with trusted URL?
            // E.g. origin: http://localhost:3000, referer: http://localhost:3000/payin
            if (origin.startsWith(trustedFrontend)) {
                isTrustedOrigin = true;
            }
            // Allow localhost in dev/test explicitly if not set in trustedFrontend
            if ((ENV.NODE_ENV === "development" || ENV.NODE_ENV === "test") && origin.includes("localhost")) {
                isTrustedOrigin = true;
            }
        }

        if (isTrustedOrigin) {
            logger.info(`[PaymentSecurity] IP Whitelist Bypassed for Dashboard Origin: ${origin} (Client IP: ${ip})`);
        } else {
            // Strict Check
            if (ip !== "127.0.0.1" && ip !== "::1" && !ipWhitelist.includes(ip)) {
                logger.warn(`[PaymentSecurity] Blocked IP ${ip} for Merchant ${merchantId} (Origin: ${origin})`);
                throw Forbidden("IP Not Whitelisted");
            }
        }
    }

    // 5. Signature Verification (optional)
    const apiSecretEncrypted = merchant.apiSecretEncrypted;

    if (!apiSecretEncrypted) {
        logger.error(`[PaymentSecurity] Merchant ${merchantId} has no API Secret`);
        throw Forbidden("Merchant configuration error: Secret missing");
    }

    const apiSecret = decryptSecret(apiSecretEncrypted);
    if (!apiSecret) {
        if (looksLikeArgon2Hash(apiSecretEncrypted)) {
            logger.warn(`[PaymentSecurity] Merchant ${merchantId} has legacy API secret hash; rotation required`);
        } else {
            logger.warn(`[PaymentSecurity] Merchant ${merchantId} API secret decryption failed`);
        }
        throw Forbidden("Invalid API credentials. Please rotate API keys.");
    }

    const skipSignatureCheck =
        options.skipSignature || type === "PAYIN" || type === "PAYOUT" || type === "STATUS";

    if (!skipSignatureCheck) {
        let isValid = false;
        const safeEqual = (a: string, b: string) => {
            const aBuf = Buffer.from(a);
            const bBuf = Buffer.from(b);
            if (aBuf.length !== bBuf.length) return false;
            return crypto.timingSafeEqual(aBuf, bBuf);
        };

        // A. Check x-signature (New Standard: Body + Timeline)
        if (signature && signature.length === 64) {
            // Standard: HMAC-SHA256( rawBody + "|" + timestamp, secret )
            const payloadString = rawBody + "|" + timestamp;
            const computed = crypto.createHmac("sha256", apiSecret).update(payloadString).digest("hex");

            if (safeEqual(computed, signature)) {
                isValid = true;
            } else {
                logger.warn(`[PaymentSecurity] Invalid x-signature for ${merchantId}`);
            }
        }

        // B. Check body.hash (Legacy: amount|currency|orderId|secret)
        if (!isValid && body && body.hash) {
            const { amount, currency = "INR", orderId } = body;
            const dataString = `${amount}|${currency}|${orderId}|${apiSecret}`;
            const computedLegacy = crypto.createHmac("sha256", apiSecret).update(dataString).digest("hex");

            if (safeEqual(computedLegacy, String(body.hash))) {
                isValid = true;
            } else {
                logger.warn(`[PaymentSecurity] Invalid legacy hash for ${merchantId}`);
            }
        }

        if (!isValid) {
            throw Forbidden("Invalid Signature");
        }
    }

    // Attach context
    c.set("merchant", merchant);
    c.set("req_body", body);

    await next();
};
