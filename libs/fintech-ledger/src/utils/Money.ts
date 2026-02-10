/**
 * Currency Utility: INR Helper
 * Strict conversion between Rupees (Decimal String/Number) and Paisa (BigInt).
 * Note: bigint inputs are rejected to enforce rupee-only external inputs.
 */
export class Money {
    private static readonly RUPEE_PATTERN = /^-?\d+(\.\d{1,2})?$/;

    static assertRupeesInput(value: unknown, fieldName = 'amount'): void {
        if (typeof value === 'bigint') {
            throw new Error(`Invalid ${fieldName}: bigint (paisa) inputs are not allowed`);
        }
        if (value === null || value === undefined) {
            throw new Error(`Invalid ${fieldName}: value is required`);
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                throw new Error(`Invalid ${fieldName}: must be a finite number`);
            }
            const str = value.toString();
            if (!Money.RUPEE_PATTERN.test(str)) {
                throw new Error(`Invalid ${fieldName}: must be rupees with max 2 decimals`);
            }
            return;
        }
        if (typeof value === 'string') {
            const str = value.trim();
            if (!Money.RUPEE_PATTERN.test(str)) {
                throw new Error(`Invalid ${fieldName}: must be rupees with max 2 decimals`);
            }
            return;
        }
        throw new Error(`Invalid ${fieldName}: unsupported type`);
    }

    /**
     * Converts Rupees to Paisa (BigInt).
     * @param rupees "100.50", "10", 100.50
     * @returns 10050n
     */
    static toPaisa(rupees: string | number): bigint {
        Money.assertRupeesInput(rupees, 'amount');
        const str = rupees.toString().trim();
        const sign = str.startsWith('-') ? -1n : 1n;
        const normalized = sign === -1n ? str.slice(1) : str;
        const parts = normalized.split('.');

        let integral = BigInt(parts[0] || '0');
        let fractional = 0n;

        if (parts.length > 1) {
            const fractionStr = parts[1].padEnd(2, '0').slice(0, 2); // Take first 2 digits
            fractional = BigInt(fractionStr);
        }

        // Combined: (Integral * 100) + Fractional
        // Re-apply sign
        return sign * ((integral * 100n) + fractional);
    }

    static normalizeRupees(rupees: string | number): string {
        return Money.toRupees(Money.toPaisa(rupees));
    }

    static negateRupees(rupees: string | number): string {
        const normalized = Money.normalizeRupees(rupees);
        return normalized.startsWith('-') ? normalized : `-${normalized}`;
    }

    /**
     * Converts Paisa (BigInt) to Rupees (String).
     * @param paisa 10050n
     * @returns "100.50"
     */
    static toRupees(paisa: bigint | string): string {
        const val = BigInt(paisa);
        const sign = val < 0n ? "-" : "";
        const abs = val < 0n ? -val : val;

        const integral = abs / 100n;
        const fractional = abs % 100n;

        return `${sign}${integral.toString()}.${fractional.toString().padStart(2, '0')}`;
    }
}
