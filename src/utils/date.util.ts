import { IST_OFFSET_MS } from "@/constants/common.constant";

/**
 * Returns a new Date object representing the current time shifted to IST.
 * This is useful if you want to store a UTC timestamp that *looks* like IST in a DB viewer.
 * e.g. Real: 10:00 UTC (15:30 IST) -> Returns: 15:30 UTC
 */
export function getISTDate(): Date {
    const now = new Date();
    return new Date(now.getTime() + IST_OFFSET_MS);
}

/**
 * Converts a given date to IST (Shifted).
 */
export function toIST(date: Date | string): Date {
    const d = new Date(date);
    return new Date(d.getTime() + IST_OFFSET_MS);
}

/**
 * Returns the start and end Date (in UTC) corresponding to "Today" in IST.
 * Start: 00:00:00 IST (UTC equivalent)
 * End: 23:59:59.999 IST (UTC equivalent)
 */
export function getTodayRangeIST(): { start: Date; end: Date } {
    const now = new Date();
    // Shift to "Visual IST"
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);

    // Start of Day (Visual IST 00:00:00)
    const istStart = new Date(istNow);
    istStart.setUTCHours(0, 0, 0, 0);

    // End of Day (Visual IST 23:59:59.999)
    const istEnd = new Date(istNow);
    istEnd.setUTCHours(23, 59, 59, 999);

    // Shift back to real UTC for DB querying
    return {
        start: new Date(istStart.getTime() - IST_OFFSET_MS),
        end: new Date(istEnd.getTime() - IST_OFFSET_MS)
    };
}

/**
 * Parses a date string (YYYY-MM-DD or ISO) and treats it as IST input, returning a Shifted IST Date.
 * If input is "2023-01-01", standard JS makes it UTC 00:00.
 * If we want to store "2023-01-01 00:00 IST" as "2023-01-01 00:00 UTC", we just return the parsed UTC date as is?
 * Wait.
 * Case A: Input "2023-01-01". JS -> 2023-01-01 00:00:00 UTC.
 * user wants: "Stored in IST". If stored as above, DB shows "2023-01-01 00:00:00".
 * This MATCHES the IST wall clock if we assume "Stored Strict IST" means "Visual Match".
 * 
 * Case B: Input "2023-01-01T10:00:00Z".
 * If we convert to IST, it becomes 15:30.
 * To store "15:30", we add offset.
 * 
 * For `backDate` (YYYY-MM-DD), let's assume it's already "Visual".
 * But `insertedDate` (System Now) needs shifting.
 */
export function getShiftedISTDate(input?: Date | string): Date {
    const d = input ? new Date(input) : new Date();
    // If input is YYYY-MM-DD, it is already 00:00 UTC.
    // If we want 00:00 IST, we store 00:00 UTC. (Visual Match)
    // So for user input YYYY-MM-DD, we likely don't need to shift if we want visual match.
    // But for `new Date()` (NOW), we DO need to shift.

    // However, if the user sends "2023-01-01", they might mean "Midnight IST".
    // 00:00 IST is 18:30 Prev Day UTC.
    // If we store 00:00 UTC, it is "05:30 IST".
    // "Strict IST" usually means "Store the number 5:30 as 5:30".

    // I will implement simple Shift for NOW(), and pass-through for Input (assuming Input is already 'local' in their mind).
    // Actually, I'll add the offset to EVERYTHING to be safe/consistent with "Strict IST Storage" request interpretation.
    return new Date(d.getTime() + IST_OFFSET_MS);
}

/**
 * Validates that a date string is in YYYY-MM-DD format.
 * @param dateString - The date string to validate
 * @returns true if valid, false otherwise
 */
export function validateDateFormat(dateString: string): boolean {
    // Strict YYYY-MM-DD format: 4 digits, dash, 2 digits, dash, 2 digits
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateString)) {
        return false;
    }

    // Additional validation: check if it's a valid date
    const date = new Date(dateString + 'T00:00:00.000Z');
    return !isNaN(date.getTime());
}

/**
 * Parses a YYYY-MM-DD date string and returns the start of that day in IST.
 * Throws an error if the format is invalid.
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Date object representing 00:00:00 IST of that day
 */
export function getISTDayStart(dateString: string): Date {
    if (!validateDateFormat(dateString)) {
        throw new Error(`Invalid date format. Expected YYYY-MM-DD, received: ${dateString}`);
    }

    // Parse as UTC midnight
    const utcDate = new Date(dateString + 'T00:00:00.000Z');

    // Convert to IST: subtract offset to get the UTC time that represents IST midnight
    // IST is UTC+5:30, so IST 00:00 = UTC 18:30 (previous day)
    const istStart = new Date(utcDate.getTime() - IST_OFFSET_MS);

    return istStart;
}

/**
 * Parses a YYYY-MM-DD date string and returns the end of that day in IST.
 * Throws an error if the format is invalid.
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Date object representing 23:59:59.999 IST of that day
 */
export function getISTDayEnd(dateString: string): Date {
    if (!validateDateFormat(dateString)) {
        throw new Error(`Invalid date format. Expected YYYY-MM-DD, received: ${dateString}`);
    }

    // Parse as UTC midnight
    const utcDate = new Date(dateString + 'T00:00:00.000Z');

    // Add one day and subtract 1ms to get end of day
    const nextDayUtc = new Date(utcDate.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Convert to IST: subtract offset
    const istEnd = new Date(nextDayUtc.getTime() - IST_OFFSET_MS);

    return istEnd;
}

/**
 * Parses YYYY-MM-DD date strings and returns IST day boundaries.
 * @param startDateString - Start date in YYYY-MM-DD format
 * @param endDateString - End date in YYYY-MM-DD format
 * @returns Object with start and end Date objects in IST
 */
export function parseDateRangeToIST(
    startDateString: string,
    endDateString: string
): { startDate: Date; endDate: Date } {
    return {
        startDate: getISTDayStart(startDateString),
        endDate: getISTDayEnd(endDateString)
    };
}
