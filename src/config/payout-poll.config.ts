export const PAYOUT_POLL_IMMEDIATE_DEFAULT = true;

// Optional overrides (code-only, no DB/env)
// Keys are provider IDs (e.g., "sabiopay")
export const PAYOUT_POLL_IMMEDIATE_BY_PROVIDER: Record<string, boolean> = {};

// Optional overrides for specific provider+legalEntity pairs (e.g., "sabiopay_main")
export const PAYOUT_POLL_IMMEDIATE_BY_CHANNEL: Record<string, boolean> = {};

export function resolvePayoutPollImmediate(
    providerId: string,
    legalEntityId?: string
): boolean {
    const channelKey =
        providerId && legalEntityId ? `${providerId}_${legalEntityId}` : undefined;

    if (channelKey && channelKey in PAYOUT_POLL_IMMEDIATE_BY_CHANNEL) {
        return PAYOUT_POLL_IMMEDIATE_BY_CHANNEL[channelKey];
    }

    if (providerId && providerId in PAYOUT_POLL_IMMEDIATE_BY_PROVIDER) {
        return PAYOUT_POLL_IMMEDIATE_BY_PROVIDER[providerId];
    }

    return PAYOUT_POLL_IMMEDIATE_DEFAULT;
}
