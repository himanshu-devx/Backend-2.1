import { AccountType } from 'fintech-ledger';
import {
    LedgerAccountEntity,
    LedgerAccountPurpose,
} from '@/constants/ledger.constant';

export class LedgerUtils {
    // =====================================================
    // Helper Methods
    // =====================================================

    /**
     * Account ID (deterministic, immutable)
     * FORMAT:
     * {TYPE}:{ENTITY}:{ENTITY_ID}:{PURPOSE}
     * EXAMPLE:
     * LIABILITY:MERCHANT:MER-123:PAYIN
     */
    static generateAccountId(
        entityType: LedgerAccountEntity | string,
        entityId: string,
        ledgerType: AccountType,
        purpose: LedgerAccountPurpose | string
    ): string {
        return `${ledgerType}:${entityType}:${entityId}:${purpose}`;
    }

    /**
     * Account Search Pattern
     * FORMAT:
     * {TYPE}:{ENTITY}:%:{PURPOSE}
     * EXAMPLE:
     * LIABILITY:MERCHANT:%:PAYIN
     */
    static generateAccountPattern(
        entityType: LedgerAccountEntity | string,
        ledgerType: AccountType,
        purpose: LedgerAccountPurpose | string
    ): string {
        return `${ledgerType}:${entityType}:%:${purpose}`;
    }

    /**
     * Human-readable Account Code (for UI / ops)
     * FORMAT:
     * {ENTITY}:{NAME}:{PURPOSE}
     * EXAMPLE:
     * MERCHANT:FLIPKART:PAYIN
     */
    static generateAccountCode(
        entityType: LedgerAccountEntity | string,
        name: string,
        entityId: string,
        purpose: LedgerAccountPurpose | string,
    ): string {
        const safeName = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const safeEntityId = entityId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        return `${entityType}:${safeName}:${safeEntityId}:${purpose}`;
    }

    /**
     * Parse Account ID back to components
     * Returns null if format is invalid
     */
    static parseAccountId(id: string): {
        ledgerType: AccountType;
        entityType: string;
        entityId: string;
        purpose: string;
    } | null {
        const parts = id.split(':');
        if (parts.length < 4) return null;

        // Format: {TYPE}:{ENTITY}:{ENTITY_ID}:{PURPOSE}
        const [ledgerType, entityType, entityId, ...purposeParts] = parts;

        return {
            ledgerType: ledgerType as AccountType,
            entityType,
            entityId,
            purpose: purposeParts.join(':')
        };
    }

    /**
     * Parse Account Code back to components
     * Returns null if format is invalid
     */
    static parseAccountCode(code: string): {
        entityType: string;
        name: string;
        entityId?: string;
        purpose: string;
    } | null {
        const parts = code.split(':');
        if (parts.length < 3) return null;

        if (parts.length >= 4) {
            // Format: {ENTITY}:{NAME}:{ENTITY_ID}:{PURPOSE}
            const [entityType, name, entityId, ...purposeParts] = parts;
            return {
                entityType,
                name,
                entityId,
                purpose: purposeParts.join(':')
            };
        }

        // Legacy Format: {ENTITY}:{NAME}:{PURPOSE}
        const [entityType, name, ...purposeParts] = parts;
        return {
            entityType,
            name,
            purpose: purposeParts.join(':')
        };
    }
}
