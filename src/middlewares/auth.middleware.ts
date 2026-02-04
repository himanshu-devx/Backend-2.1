// src/middlewares/auth.middleware.ts

import { Context, MiddlewareHandler, Next } from "hono";
import jwt, { JwtPayload } from "jsonwebtoken";
import { ENV } from "@/config/env";
import {
  getRoleCategory,
  ROLE_CATEGORY,
  UserRoleType,
} from "@/constants/users.constant";
import { Unauthorized, Forbidden } from "@/utils/error";
import { merchantRepository } from "@/repositories/merchant.repository";
import { adminRepository } from "@/repositories/admin.repository";

interface TokenPayload extends JwtPayload {
  id: string;
  email?: string;
  role?: UserRoleType | string;
}

export const authMiddleware: MiddlewareHandler = async (
  c: Context,
  next: Next
) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw Unauthorized(
      "Unauthorized: Missing or invalid Authorization header."
    );
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw Unauthorized("Unauthorized: Empty token.");
  }

  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET, {}) as TokenPayload;

    if (!decoded || !decoded.id) {
      throw Unauthorized("Unauthorized: Invalid token payload.");
    }

    const category = getRoleCategory(decoded.role as UserRoleType);
    let user;

    if (category === ROLE_CATEGORY.MERCHANT) {
      // Use findOne({ id: ... }) because we use custom string IDs, not _id
      user = await merchantRepository.findOne({ id: decoded.id });
    } else {
      user = await adminRepository.findOne({ id: decoded.id });
    }

    if (!user || !user.status) {
      throw Unauthorized("Unauthorized: Account inactive.");
    }

    c.set("id", decoded.id);
    c.set("role", (decoded.role ?? "UNKNOWN") as UserRoleType);
    if (decoded.email) c.set("email", decoded.email);

    await next();
  } catch (err: any) {
    const expired = err?.name === "TokenExpiredError";
    const reason = expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN";

    throw Unauthorized(
      `Unauthorized: ${
        expired ? "Token expired." : "Token verification failed."
      }`,
      {
        code: reason,
        cause: err,
      }
    );
  }
};

export const authorizeRoles =
  (requiredRoles: (UserRoleType | string)[]): MiddlewareHandler =>
  async (c: Context, next: Next) => {
    const role = c.get("role") as UserRoleType | undefined;
    if (!role) {
      throw Unauthorized("Unauthorized: Role missing.");
    }
    if (!requiredRoles.includes(role)) {
      throw Forbidden("Forbidden: Insufficient permissions.");
    }
    return next();
  };
