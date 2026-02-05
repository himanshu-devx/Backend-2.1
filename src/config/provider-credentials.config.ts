import { ENV } from "./env";

export interface ProviderConfig {
    providerId: string;
    legalEntityId?: string;
    baseUrl?: string;
    credentials: {
        apiKey?: string;
        apiSecret?: string;
        apiSalt?: string;
        merchantId?: string;
        webhookSecret?: string;
        [key: string]: any;
    };
}

/**
 * Provider Credentials Configuration
 * Maps PLE IDs to provider credentials from environment variables
 * 
 * To add a new provider account:
 * 1. Add environment variables for the credentials
 * 2. Add entry here with the PLE ID from your database
 * 3. The providerId should match the provider slug in your Provider model
 */
export const PROVIDER_CREDENTIALS: Record<string, ProviderConfig> = {
    // Dummy Provider - Default Legal Entity
    // Provider: dummy, Legal Entity: default
    "PLE-1": {
        providerId: "dummy",
        legalEntityId: "default",
        credentials: {
            // Dummy provider doesn't need real credentials
            apiKey: "DUMMY_KEY",
            apiSalt: "DUMMY_SALT",
        }
    },
};

/**
 * Get provider configuration by PLE ID
 * @param pleId - Provider Legal Entity ID (e.g., "PLE-001")
 * @returns Provider configuration
 * @throws Error if PLE ID not found
 */
export function getProviderConfig(pleId: string): ProviderConfig {
    const config = PROVIDER_CREDENTIALS[pleId];
    if (!config) {
        throw new Error(`No credentials configured for PLE ID: ${pleId}. Please add configuration in provider-credentials.config.ts`);
    }

    return config;
}

/**
 * Check if a PLE ID has configured credentials
 * @param pleId - Provider Legal Entity ID
 * @returns true if credentials exist
 */
export function hasProviderConfig(pleId: string): boolean {
    return !!PROVIDER_CREDENTIALS[pleId];
}

/**
 * Get all configured PLE IDs
 * @returns Array of PLE IDs
 */
export function getConfiguredPleIds(): string[] {
    return Object.keys(PROVIDER_CREDENTIALS);
}
