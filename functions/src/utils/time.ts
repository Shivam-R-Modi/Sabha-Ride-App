/**
 * Local-time helpers for schedule logic.
 *
 * Cloud Functions run with the server clock in UTC, so `new Date().getDay()`
 * and `.getHours()` return UTC values. Every schedule rule in this codebase is
 * written in Sabha local time, so reading them off a UTC clock shifts the whole
 * window by 4-5 hours and rolls the day over early:
 *
 *   Fri 6:00 PM  Boston  ->  Fri 22:00 UTC  -> read as "after 10 PM"
 *   Fri 10:30 PM Boston  ->  Sat 02:30 UTC  -> read as "not Friday"
 *
 * Always derive day/hour through `getZonedParts` rather than the Date getters.
 *
 * The zone is an IANA identifier, never a fixed offset, so daylight saving is
 * handled by the zone database instead of by us. `America/New_York` is EDT
 * (UTC-4) in summer and EST (UTC-5) in winter automatically.
 */

/**
 * Default Sabha timezone. Stage 1 moves this into `settings/schedule` so a
 * manager can change it; until then it is the single place it is written down.
 */
export const DEFAULT_TIME_ZONE = 'America/New_York';

export interface ZonedParts {
    /** 0 = Sunday … 6 = Saturday, in the target zone */
    dayOfWeek: number;
    /** 0-23, in the target zone */
    hour: number;
    /** 0-59, in the target zone */
    minute: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** True if the runtime's ICU data recognises this IANA identifier. */
export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch {
        return false;
    }
}

/**
 * Break an instant into day-of-week / hour / minute **as observed in
 * `timeZone`**, with daylight saving already applied.
 *
 * An unusable zone falls back to DEFAULT_TIME_ZONE and warns rather than
 * throwing: this runs inside a scheduled job whose failure mode would be
 * "no rides at all", and silently closing the service strands people.
 */
export function getZonedParts(date: Date, timeZone: string = DEFAULT_TIME_ZONE): ZonedParts {
    let zone = timeZone;
    if (!isValidTimeZone(zone)) {
        console.warn(`[time] Unknown time zone "${timeZone}" — falling back to ${DEFAULT_TIME_ZONE}`);
        zone = DEFAULT_TIME_ZONE;
    }

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        // h23 keeps midnight as 00 rather than 24, which hour12:false can emit.
        hourCycle: 'h23',
    }).formatToParts(date);

    const valueOf = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

    return {
        dayOfWeek: WEEKDAY_INDEX[valueOf('weekday')] ?? 0,
        hour: Number(valueOf('hour')),
        minute: Number(valueOf('minute')),
    };
}

/** Minutes since local midnight — convenient for window comparisons. */
export function minutesSinceMidnight(date: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
    const { hour, minute } = getZonedParts(date, timeZone);
    return hour * 60 + minute;
}
