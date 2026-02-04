import { CacheService } from '@/services/common/cache.service';
import { ProviderLegalEntityDocument } from '@/models/provider-legal-entity.model';

/**
 * Payment Routing Service
 * Selects the appropriate provider based on merchant configuration
 */
export class PaymentRoutingService {
    /**
     * Select provider for a merchant's transaction
     * Returns the PLE ID to use for the transaction
     * 
     * @param merchantId - Merchant ID
     * @param serviceType - PAYIN or PAYOUT
     * @returns PLE ID (e.g., "PLE-001")
     * @throws Error if routing not configured or provider inactive
     */
    static async selectProvider(
        merchantId: string,
        serviceType: 'PAYIN' | 'PAYOUT'
    ): Promise<string> {
        // Get merchant from cache
        const merchant = await CacheService.getMerchant(merchantId);
        if (!merchant) {
            throw new Error('Merchant not found');
        }

        // Get service configuration
        const config = serviceType === 'PAYIN' ? merchant.payin : merchant.payout;

        // Check if service is active
        if (!config.isActive) {
            throw new Error(`${serviceType} service is not active for this merchant`);
        }

        // Check if routing is configured
        if (!config.routing || !config.routing.providerId || !config.routing.legalEntityId) {
            throw new Error(`${serviceType} routing not configured for merchant. Please configure provider and legal entity in merchant settings.`);
        }

        // Get the Provider Legal Entity (channel)
        const ple = await CacheService.getChannel(
            config.routing.providerId,
            config.routing.legalEntityId
        );

        if (!ple) {
            throw new Error(`Provider Legal Entity not found for provider: ${config.routing.providerId}, legal entity: ${config.routing.legalEntityId}`);
        }

        if (!ple.isActive) {
            throw new Error('Provider Legal Entity is inactive');
        }

        // Check service-specific activation on PLE
        const pleServiceConfig = serviceType === 'PAYIN' ? ple.payin : ple.payout;
        if (!pleServiceConfig.isActive) {
            throw new Error(`${serviceType} is not active for this provider`);
        }

        // Return the PLE ID
        return ple.id;
    }

    /**
     * Select provider with fallback support
     * If primary provider fails, can try fallback providers
     * 
     * @param merchantId - Merchant ID
     * @param serviceType - PAYIN or PAYOUT
     * @param excludePleIds - PLE IDs to exclude (already failed)
     * @returns PLE ID
     */
    static async selectProviderWithFallback(
        merchantId: string,
        serviceType: 'PAYIN' | 'PAYOUT',
        excludePleIds: string[] = []
    ): Promise<string> {
        // For now, just use primary routing
        // TODO: Implement fallback logic by checking multiple PLE configurations
        // This could involve:
        // 1. Checking merchant's secondary routing configs
        // 2. Checking provider health metrics
        // 3. Round-robin across multiple providers

        const pleId = await this.selectProvider(merchantId, serviceType);

        // Check if this PLE is excluded
        if (excludePleIds.includes(pleId)) {
            throw new Error('Primary provider failed and no fallback configured');
        }

        return pleId;
    }

    /**
     * Get provider details for a merchant
     * Useful for displaying provider info in admin panel
     * 
     * @param merchantId - Merchant ID
     * @param serviceType - PAYIN or PAYOUT
     * @returns Provider Legal Entity document
     */
    static async getProviderDetails(
        merchantId: string,
        serviceType: 'PAYIN' | 'PAYOUT'
    ): Promise<ProviderLegalEntityDocument | null> {
        try {
            const pleId = await this.selectProvider(merchantId, serviceType);
            const merchant = await CacheService.getMerchant(merchantId);
            if (!merchant) return null;

            const config = serviceType === 'PAYIN' ? merchant.payin : merchant.payout;

            return await CacheService.getChannel(
                config.routing!.providerId,
                config.routing!.legalEntityId
            );
        } catch (error) {
            return null;
        }
    }
}
