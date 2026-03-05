/**
 * Week Utilities for Sabha Ride Seva
 * 
 * Week cycle: Saturday 12:00 AM to Friday 11:59 PM
 * weekId format: YYYY-MM-DD (the Friday of current week)
 */

/**
 * Gets the Friday date of the current week cycle.
 * - If today is Saturday, returns next week's Friday
 * - Week cycle: Saturday 12:00 AM to Friday 11:59 PM
 * 
 * @returns Date string in "YYYY-MM-DD" format (e.g., "2026-02-06")
 */
export const getCurrentWeekId = (): string => {
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

/**
 * Checks if the user can change their response from "yes" to "no".
 * Cutoff is Thursday 6:00 PM of the current week.
 * 
 * @returns true if current time is before Thursday 6:00 PM
 */
export const canChangeResponseToNo = (): boolean => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 4 = Thursday, 5 = Friday, 6 = Saturday
    const hours = now.getHours();

    // If it's Saturday, we're in a new week - can change
    if (dayOfWeek === 6) {
        return true;
    }

    // If it's Friday, cutoff has passed
    if (dayOfWeek === 5) {
        return false;
    }

    // If it's Thursday
    if (dayOfWeek === 4) {
        // Cutoff is 6:00 PM (18:00)
        return hours < 18;
    }

    // Sunday (0) to Wednesday (3) - can change
    return true;
};

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
