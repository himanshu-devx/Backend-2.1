import { getProviderConfig } from "@/config/provider-credentials.config";
import { BaseProvider } from "./base-provider";
import { getProviderRegistration } from "./provider-registry";
import type { ProviderConfig } from "./types";


/**
 * Provider Factory
 * Instantiates the appropriate provider based on PLE ID
 */
export class ProviderFactory {
  private static instanceCache = new Map<string, BaseProvider>();

  private static toId(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "");
  }

  private static parsePleId(pleId: string): {
    providerId: string;
    legalEntityId: string;
    pleId: string;
  } {
    const parts = pleId.split("_").filter(Boolean);
    if (parts.length >= 2) {
      const providerId = this.toId(parts[0]);
      const legalEntityId = this.toId(parts[1]);
      return {
        providerId,
        legalEntityId,
        pleId: `${providerId}_${legalEntityId}`,
      };
    }
    const providerId = this.toId(pleId);
    return {
      providerId,
      legalEntityId: "default",
      pleId: providerId,
    };
  }

  /**
   * Get provider instance by PLE ID
   * @param pleId - Provider Legal Entity ID (e.g., "PLE-001")
   * @returns Provider instance
   * @throws Error if provider not supported or not found
   */
  static getProvider(pleId: string): BaseProvider {
    const cached = this.instanceCache.get(pleId);
    if (cached) return cached;

    let config: ProviderConfig;
    try {
      config = getProviderConfig(pleId);
    } catch (err: any) {
      const parsed = this.parsePleId(pleId);
      const registration = getProviderRegistration(parsed.providerId);
      const isMissingCreds =
        err instanceof Error &&
        err.message.includes("No credentials for PLE/Provider ID");
      if (registration?.allowEmptyCredentials && isMissingCreds) {
        config = {
          pleId: parsed.pleId,
          providerId: parsed.providerId,
          legalEntityId: parsed.legalEntityId,
          credentials: {},
        };
      } else {
        throw err;
      }
    }

    const registration = getProviderRegistration(config.providerId);

    if (!registration) {
      throw new Error(`Unsupported provider: ${config.providerId}`);
    }

    const instance = registration.create(config as any);
    this.instanceCache.set(pleId, instance);
    return instance;
  }
}
