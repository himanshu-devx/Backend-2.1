import { BaseProvider } from './base-provider';
import { getProviderConfig } from '@/config/provider-credentials.config';
import { AlphaPayProvider } from './alphapay.provider';
// import { RazorpayProvider } from './razorpay.provider'; // Commented out until file exists or verified

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
            case 'alphapay':
                return this.getAlphaPayProvider(config);

            case 'razorpay':
                return this.getRazorpayProvider(config);

            default:
                throw new Error(`Unsupported provider: ${config.providerId}`);
        }
    }

    /**
     * Get AlphaPay provider instance
     */
    private static getAlphaPayProvider(config: any): BaseProvider {
        return new AlphaPayProvider(config);
    }

    /**
     * Get Razorpay provider instance
     */
    private static getRazorpayProvider(config: any): BaseProvider {
        // const { RazorpayProvider } = require('./razorpay.provider');
        // return new RazorpayProvider(config);
        throw new Error("Razorpay not fully implemented yet");
    }
}
