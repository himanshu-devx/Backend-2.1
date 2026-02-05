/**
 * Currency Utility: INR Helper
 * Strict conversion between Rupees (Decimal String) and Paisa (BigInt).
 */
export class Money {
    /**
     * Converts Rupees to Paisa (BigInt).
     * @param rupees "100.50", "10", 100.50
     * @returns 10050n
     */
    static toPaisa(rupees: string | number | bigint): bigint {
        if (typeof rupees === 'bigint') {
            return rupees;
        }
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
