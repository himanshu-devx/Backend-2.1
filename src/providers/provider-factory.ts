import { BaseProvider } from './base-provider';
import { getProviderConfig } from '@/config/provider-credentials.config';
import { DummyProvider } from './dummy.provider';

/**
 * Provider Factory
 * Instantiates the appropriate provider based on PLE ID
 */
export class ProviderFactory {
    /**
     * Get provider instance by PLE ID
     * @param pleId - Provider Legal Entity ID (e.g., "PLE-001")
     * @returns Provider instance
     * @throws Error if provider not supported or not found
     */
    static getProvider(pleId: string): BaseProvider {
        const config = getProviderConfig(pleId);

        switch (config.providerId.toLowerCase()) {
            case 'dummy':
            case 'alphapay': // Map existing AlphaPay configs to Dummy for seamless transition
                return this.getDummyProvider(config);

            default:
                throw new Error(`Unsupported provider: ${config.providerId}`);
        }
    }

    /**
     * Get Dummy provider instance
     */
    private static getDummyProvider(config: any): BaseProvider {
        return new DummyProvider(config);
    }
}

