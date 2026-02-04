// src/utils/helper.ts

import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { ENV } from "@/config/env";

/**
 * Generates a JSON Web Token (JWT) for authentication.
 * * @param payload The data to be encoded in the token (e.g., user ID, role).
 * @returns A signed JWT string.
 */
export function generateAuthToken(payload: {
  id: string;
  email: string;
  role: string;
}): string {
  const secret = ENV.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not defined.");
  }

  const options: SignOptions = {
    expiresIn: "7d", // Token expires in 7 days
    issuer: "YourPlatformIssuer", // Optional: Identifies the issuer
    subject: payload.id, // Optional: Identifies the principal (user ID)
  };

  // 3. Sign and return the token
  const token = jwt.sign(payload, secret, options);

  return token;
}
