import { KEY_ALIASES } from "@/provider-config/provider-registry";
import { ProviderConfig, ProviderCredentials } from "@/provider-config/types";


export type ProviderCredentialsMap = Record<string, ProviderConfig>;


const RESERVED_SUFFIXES = new Set(["PROVIDER_ID", "LEGAL_ENTITY_ID", "PLE_ID"]);



const normalizeString = (value?: string): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const toId = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");

const normalizeCredentialKey = (suffix: string): string | undefined => {
  const compact = suffix.toLowerCase().replace(/[^a-z0-9]/g, "");
  return KEY_ALIASES[compact];
};

const normalizePleIdInput = (pleId: string): string => {
  const cleaned = pleId.trim();
  const parts = cleaned.split("_").filter(Boolean);
  if (parts.length >= 2) {
    return `${toId(parts[0])}_${toId(parts[1])}`;
  }
  return toId(cleaned);
};

const loadFromEnv = (): ProviderCredentialsMap => {
  const result: ProviderCredentialsMap = {};

  for (const [key, rawValue] of Object.entries(process.env)) {
    const value = normalizeString(rawValue as string | undefined);
    if (!value) continue;

    const parts = key.split("_").filter(Boolean);
    if (parts.length < 2) continue;

    const providerPart = parts[0];
    const hasLegalPart = parts.length >= 3;
    const legalPart = hasLegalPart ? parts[1] : "DEFAULT";
    const suffix = hasLegalPart ? parts.slice(2).join("_") : parts[1];
    if (!suffix || RESERVED_SUFFIXES.has(suffix)) continue;

    const providerId = toId(providerPart);
    const legalEntityId = toId(legalPart);
    if (!providerId || !legalEntityId) continue;

    const pleId = hasLegalPart ? `${providerId}_${legalEntityId}` : providerId;
    if (!result[pleId]) {
      result[pleId] = {
        pleId,
        providerId,
        legalEntityId,
        credentials: {},
      };
    }

    const credentialKey = normalizeCredentialKey(suffix);
    if (!credentialKey) continue;
    (result[pleId].credentials as ProviderCredentials)[credentialKey] = value;
  }

  return result;
};

export const PROVIDER_CREDENTIALS: ProviderCredentialsMap = loadFromEnv();

export function getProviderConfig(pleId: string): ProviderConfig {
  const direct = PROVIDER_CREDENTIALS[pleId];
  if (direct) return direct;

  const normalized = normalizePleIdInput(pleId);
  const config = PROVIDER_CREDENTIALS[normalized];
  if (config) return config;

  const matches = Object.values(PROVIDER_CREDENTIALS).filter(
    (item) => item.providerId === normalized
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Multiple credentials found for provider: ${normalized}. Use providerId_legalEntityId.`
    );
  }

  throw new Error(
    `No credentials for PLE/Provider ID: ${pleId}. Use PROVIDERID_LEGALENTITY_APIKEY or PROVIDERID_APIKEY.`
  );
}
