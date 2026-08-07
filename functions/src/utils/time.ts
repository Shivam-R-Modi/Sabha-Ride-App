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

/** How far `timeZone` is from UTC at this instant, in milliseconds. */
function zoneOffsetMs(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);

    const valueOf = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

    const asIfUtc = Date.UTC(
        valueOf('year'), valueOf('month') - 1, valueOf('day'),
        valueOf('hour'), valueOf('minute'), valueOf('second'),
    );

    return asIfUtc - date.getTime();
}

/**
 * Turn a local wall-clock time into an absolute instant.
 *
 * `dateKey` is "YYYY-MM-DD" and `hhmm` is "HH:MM", both as read on a clock in
 * `timeZone`. Returns an ISO string.
 *
 * This is what lets the server publish absolute instants and the clients simply
 * compare them against `now` — no client ever computes a day-of-week or an
 * hour, which is the entire class of bug that broke drop-off rides every Friday.
 *
 * Two passes, because the offset depends on the instant we are trying to find.
 * The first guess gets us close enough to read the right offset; the second
 * catches the daylight-saving boundary where the first guess landed on the wrong
 * side.
 */
export function zonedTimeToInstant(
    dateKey: string,
    hhmm: string,
    timeZone: string = DEFAULT_TIME_ZONE,
): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hour, minute] = hhmm.split(':').map(Number);

    const naive = Date.UTC(year, month - 1, day, hour, minute);

    const firstOffset = zoneOffsetMs(new Date(naive), timeZone);
    let instant = naive - firstOffset;

    const secondOffset = zoneOffsetMs(new Date(instant), timeZone);
    if (secondOffset !== firstOffset) {
        instant = naive - secondOffset;
    }

    return new Date(instant).toISOString();
}

/**
 * Calendar date (YYYY-MM-DD) as read in the given zone.
 *
 * Deriving this from the UTC server clock rolls the date over mid-evening in the
 * Americas — the same failure as the ride-window scheduling.
 */
export function zonedDateKey(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}

/**
 * Shift a "YYYY-MM-DD" key by whole days.
 *
 * Pure calendar arithmetic in UTC, deliberately: adding 24-hour spans to an
 * instant double-counts or skips an hour across a daylight-saving change, and
 * would land the wrong date twice a year.
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
