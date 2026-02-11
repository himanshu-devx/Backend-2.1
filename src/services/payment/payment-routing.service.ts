import { CacheService } from '@/services/common/cache.service';
import { ProviderClient } from '@/services/provider-config/provider-client.service';
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
        const chain = await this.getProviderChain(merchantId, serviceType);
        const filtered = chain.filter((c) => !excludePleIds.includes(c.id));
        if (filtered.length === 0) {
            throw new Error('No available provider channels after fallback filtering');
        }
        return filtered[0].id;
    }

    /**
     * Get provider chain (primary + fallbacks) for a merchant
     */
    static async getProviderChain(
        merchantId: string,
        serviceType: 'PAYIN' | 'PAYOUT'
    ): Promise<ProviderLegalEntityDocument[]> {
        const merchant = await CacheService.getMerchant(merchantId);
        if (!merchant) {
            throw new Error('Merchant not found');
        }

        const config = serviceType === 'PAYIN' ? merchant.payin : merchant.payout;

        if (!config.isActive) {
            throw new Error(`${serviceType} service is not active for this merchant`);
        }

        if (!config.routing || !config.routing.providerId || !config.routing.legalEntityId) {
            throw new Error(`${serviceType} routing not configured for merchant. Please configure provider and legal entity in merchant settings.`);
        }

        const routingChain = [
            config.routing,
            ...(config.routingFallbacks || []),
        ].filter(Boolean);

        const unique = new Map<string, { providerId: string; legalEntityId: string }>();
        for (const r of routingChain) {
            const key = `${r.providerId}:${r.legalEntityId}`;
            if (!unique.has(key)) unique.set(key, r);
        }

        const channels: ProviderLegalEntityDocument[] = [];
        for (const r of unique.values()) {
            const ple = await CacheService.getChannel(r.providerId, r.legalEntityId);
            if (!ple || !ple.isActive) continue;
            const pleServiceConfig = serviceType === 'PAYIN' ? ple.payin : ple.payout;
            if (!pleServiceConfig?.isActive) continue;
            channels.push(ple);
        }

        if (channels.length === 0) {
            throw new Error(`No active provider channels for ${serviceType}`);
        }

        return channels;
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
            const merchant = await CacheService.getMerchant(merchantId);
            if (!merchant) return null;

            const config = serviceType === 'PAYIN' ? merchant.payin : merchant.payout;

            const details = await CacheService.getChannel(
                config.routing!.providerId,
                config.routing!.legalEntityId
            );
            if (!details) return null;

            const webhookUrl = await ProviderClient.buildWebhookUrl(
                serviceType,
                config.routing!.providerId,
                config.routing!.legalEntityId
            );

            return { ...(details as any), webhookUrl } as ProviderLegalEntityDocument;
        } catch (error) {
            return null;
        }
    }
}
