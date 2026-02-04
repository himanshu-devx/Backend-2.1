import { Context } from "hono";

export interface AuditContext {
  actorId?: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  origin?: string;
}

// ... helper functions restored ...

/**
 * Validates if a string is a valid IPv4 address
 */
const isValidIPv4 = (ip: string): boolean => {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
};

/**
 * Extracts IPv4 address from request headers
 * Checks x-forwarded-for and x-real-ip headers
 * Returns only valid IPv4 addresses, fallback to 127.0.0.1
 */
const extractIPv4 = (c: Context): string => {
  // Check x-forwarded-for header (can contain multiple IPs)
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    for (const ip of ips) {
      if (isValidIPv4(ip)) {
        return ip;
      }
    }
  }

  // Check x-real-ip header
  const realIp = c.req.header("x-real-ip");
  if (realIp && isValidIPv4(realIp)) {
    return realIp;
  }

  // Fallback to localhost
  return "127.0.0.1";
};

export const getAuditContext = (c: Context): AuditContext => {
  const ipAddress = extractIPv4(c);
  const userAgent = c.req.header("user-agent");
  const origin = c.req.header("origin");
  const requestId = c.get("requestId");
  const correlationId = c.get("correlationId");

  // Auth Middleware sets these
  const actorId = c.get("id");
  const actorEmail = c.get("email");

  return {
    actorId,
    actorEmail,
    ipAddress,
    userAgent,
    requestId,
    correlationId,
    origin,
  };
};
