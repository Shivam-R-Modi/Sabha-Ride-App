/**
 * Week Utilities for Sabha Ride Seva
 *
 * The gathering's identity now comes from the server, via `useCurrentEvent` —
 * see hooks/useCurrentEvent.ts. Read it from there, not from here.
 *
 * What remains below is a fallback for the moment before the scheduler has
 * published, plus date formatting.
 */

/**
 * The gathering's date, worked out locally.
 *
 * ONLY for use before the server has published `eventId`. It reads the device
 * clock, so a phone in another timezone — or with the wrong date set — resolves
 * a different gathering than the manager sees, which silently splits the
 * attendance record in two. That is the bug `useCurrentEvent` exists to fix.
 *
 * Kept so attendance keeps working through the deploy rather than writing to an
 * `undefined` key. Delete once the scheduler has been live for a week.
 *
 * @returns Date string in "YYYY-MM-DD" format (e.g., "2026-02-06")
 */
export const fallbackEventId = (): string => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday

    let daysUntilFriday: number;

    if (dayOfWeek === 6) {
        // Saturday: next Friday is 6 days away
        daysUntilFriday = 6;
    } else if (dayOfWeek === 5) {
        // Friday: it's this Friday (0 days)
        daysUntilFriday = 0;
    } else {
        // Sunday (0) to Thursday (4): calculate days until Friday
        daysUntilFriday = 5 - dayOfWeek;
    }

    const friday = new Date(now);
    friday.setDate(now.getDate() + daysUntilFriday);

    // Format as YYYY-MM-DD
    const year = friday.getFullYear();
    const month = String(friday.getMonth() + 1).padStart(2, '0');
    const day = String(friday.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
};

// canChangeResponseToNo used to live here and derived "is it past Thursday 6
// PM?" from the device clock and a hardcoded day-of-week. The server now
// publishes `attendanceLocksAt` as an absolute instant and the client simply
// compares it against now — see the `canWithdraw` value from useCurrentEvent.
// That also means the cutoff moves correctly if the gathering ever moves.

/**
 * Formats a timestamp into a readable date string.
 * e.g., "Feb 3, 2026 at 2:30 PM"
 * 
 * @param timestamp - ISO timestamp string
 * @returns Formatted date string
 */
export const formatResponseTime = (timestamp: string): string => {
    const date = new Date(timestamp);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();

    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';

    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12

    return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
};
