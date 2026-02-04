
/**
 * Utility functions for handling currency conversion between Major units (Rupees) and Minor units (Paisa).
 * TigerBeetle stores amounts in Paisa (128-bit unsigned integer).
 * Frontend/API expects amounts in Rupees (String or Number, typically String to preserve precision).
 */

/**
 * Converts Paisa (BigInt) to Rupee (String).
 * e.g., 1050n -> "10.50"
 */
export function paisaToRupee(paisa: bigint | string | number): string {
    const p = BigInt(paisa);
    const sign = p < 0n ? "-" : "";
    const absP = p < 0n ? -p : p;

    const major = absP / 100n;
    const minor = absP % 100n;

    return `${sign}${major.toString()}.${minor.toString().padStart(2, '0')}`;
}

/**
 * Converts Rupee (String/Number) to Paisa (BigInt).
 * e.g., "10.50" -> 1050n
 * e.g., 10.5 -> 1050n
 */
export function rupeeToPaisa(rupee: string | number): bigint {
    // Convert to string to handle decimals reliably
    let s = rupee.toString();

    // Handle negative
    let sign = 1n;
    if (s.startsWith('-')) {
        sign = -1n;
        s = s.substring(1);
    }

    const parts = s.split('.');
    const major = BigInt(parts[0] || 0);

    let minorString = (parts[1] || "").substring(0, 2); // Take only first 2 decimals
    if (minorString.length < 2) minorString = minorString.padEnd(2, '0');

    const minor = BigInt(minorString);

    return sign * ((major * 100n) + minor);
}
