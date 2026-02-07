import crypto from "crypto";
import { ENV } from "@/config/env";

const ALGO = "aes-256-gcm";
const PREFIX = "enc_v1";
const IV_LENGTH = 12;

const deriveKey = () => {
  const base = ENV.API_SECRET_ENC_KEY || ENV.JWT_SECRET;
  return crypto.createHash("sha256").update(base).digest();
};

export const encryptSecret = (plain: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
};

export const decryptSecret = (value: string): string | null => {
  if (!value || typeof value !== "string") return null;
  if (!value.startsWith(`${PREFIX}:`)) return null;

  const parts = value.split(":");
  if (parts.length !== 4) return null;

  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const key = deriveKey();

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
};

export const isEncryptedSecret = (value: string): boolean =>
  typeof value === "string" && value.startsWith(`${PREFIX}:`);

export const looksLikeArgon2Hash = (value: string): boolean =>
  typeof value === "string" && value.startsWith("$argon2");
