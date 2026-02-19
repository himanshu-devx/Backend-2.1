import crypto from "crypto";
import { ENV } from "@/config/env";

const ALGO = "aes-256-gcm";
const PREFIX = "enc_v1";
const IV_LENGTH = 12;

const parseKeyMaterials = (): string[] => {
  const primary = ENV.API_SECRET_ENC_KEY;
  if (!primary) return [];

  const extras = (ENV.API_SECRET_ENC_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = new Set([primary, ...extras]);
  return Array.from(unique);
};

const deriveKey = (material: string) =>
  crypto.createHash("sha256").update(material).digest();

const getKeyring = (): Buffer[] => parseKeyMaterials().map(deriveKey);

export const encryptSecret = (plain: string): string => {
  const keyring = getKeyring();
  if (keyring.length === 0) {
    throw new Error("API_SECRET_ENC_KEY is required for encryption.");
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = keyring[0];
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

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const keyring = getKeyring();
  if (keyring.length === 0) return null;

  for (const key of keyring) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);

      const plaintext = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      // Try next key for rotation support.
    }
  }

  return null;
};

export const isEncryptedSecret = (value: string): boolean =>
  typeof value === "string" && value.startsWith(`${PREFIX}:`);

export const looksLikeArgon2Hash = (value: string): boolean =>
  typeof value === "string" && value.startsWith("$argon2");
