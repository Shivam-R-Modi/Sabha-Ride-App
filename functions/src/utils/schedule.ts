/**
 * When rides are open, derived from a scheduled gathering.
 *
 * Every boundary here used to be a literal in updateRideTypeContext: Friday
 * only, pickup before 19:00, drop-off from 22:00. Moving sabha meant a code edit
 * and a deploy, which is not something a coordinator can do on a Thursday.
 *
 * Now a gathering has its own date, start and end (see ./events), and the
 * windows fall out of it:
 *
 *   date − 2 days, 00:00  ──────────────►  ride requests open (home → sabha)
 *   <start>                                 sabha in progress, no rides
 *   <end − 15min> ──────────────────────►  drop-off open (sabha → home)
 *   end of that day                         closed
 *
 * Drop-off deliberately opens 15 minutes BEFORE sabha ends, so drivers are
 * moving before the hall empties rather than after.
 *
 * Everything is compared as absolute instants, so nothing in this file needs to
 * know what day of the week it is. That is what lets the date move.
 */

import { addDaysToDateKey, zonedTimeToInstant } from './time';
import type { RideType } from '../types';

/**
 * Ride requests open this many days before the gathering.
 *
 * Was the constant "Wednesday". Expressed as a lead time it means the same thing
 * for a Friday sabha and keeps working when the date moves, which it now can.
 */
export const PICKUP_LEAD_DAYS = 2;

/**
 * 0 = Sunday. The day the weekly template generates events on.
 *
 * No longer the source of truth for when sabha IS — that comes from the events
 * collection. This is only the default slot new events are generated in.
 */
export const SABHA_DAY = 5; // Friday

/** Drop-off opens this many minutes before sabha ends. */
export const DROPOFF_LEAD_MINUTES = 15;

export const DEFAULT_SABHA_START = '19:00';
export const DEFAULT_SABHA_END = '22:00';

/**
 * Attendance closes at this hour, on the day before the gathering.
 * Once past it, a "yes" cannot be withdrawn — drivers are already planned
 * around it.
 */
export const ATTENDANCE_LOCK_HOUR = '18:00';

export interface ScheduleWindow {
    rideType: RideType | null;
    displayText: string;
    timeContext: string;
}

/**
 * Everything about the gathering the app is currently working towards.
 *
 * All four times are ABSOLUTE instants, deliberately. Clients compare them
 * against `now` and never compute a day-of-week or an hour themselves — which
 * is what the attendance code used to do off the *browser* clock, so a student
 * whose device was in another timezone wrote their response into a different
 * gathering's record than the one their manager was reading.
 */
export interface CurrentEvent {
    /** "YYYY-MM-DD" of the gathering, in Sabha local time. The attendance key. */
    eventId: string;
    /** Ride requests open here — PICKUP_LEAD_DAYS before, at midnight. */
    requestsOpenAt: string;
    startsAt: string;
    endsAt: string;
    /** Drop-off rides open here, 15 minutes before the end. */
    dropoffOpensAt: string;
    /** Everything shuts at the end of the gathering's own day. */
    closesAt: string;
    /** After this, a "yes" is committed. */
    attendanceLocksAt: string;
    /** Where this gathering is, when it overrides the default venue. */
    venue?: { lat: number; lng: number; address: string } | null;
    agenda?: string;
}

/**
 * Turn a gathering's date and times into the absolute instants everything else
 * compares against.
 *
 * The date is now given, not derived — it comes from the events collection. This
 * function used to work out "the upcoming Friday" itself, which is exactly the
 * assumption that made the day unchangeable.
 */
export function buildCurrentEvent(
    eventDate: string,
    startTime: unknown,
    endTime: unknown,
    timeZone: string,
    extras?: {
        venue?: { lat: number; lng: number; address: string } | null;
        agenda?: string;
    },
): CurrentEvent {
    const startMinutes = parseTimeToMinutes(startTime)
        ?? parseTimeToMinutes(DEFAULT_SABHA_START)!;
    const endMinutes = parseTimeToMinutes(endTime)
        ?? parseTimeToMinutes(DEFAULT_SABHA_END)!;

    // An end at or before the start would produce a negative-length sabha and
    // open drop-off before pickup closed.
    const safeEndMinutes = endMinutes > startMinutes ? endMinutes : startMinutes + 60;

    // Drop-off must open strictly AFTER sabha starts, otherwise a short sabha
    // inverts the window: a 19:00–19:10 gathering would put dropoffOpensAt at
    // 18:55, the `now < dropoffOpensAt` branch becomes an empty interval, and
    // pickup flips straight to drop-off the moment sabha begins — dispatching
    // drivers to take people home as they arrive, with no "in progress" state.
    // Clamped rather than rejected: this runs in a scheduled job reading
    // manager-written data, and refusing would mean no rides at all.
    const dropoffMinutes = Math.max(
        safeEndMinutes - DROPOFF_LEAD_MINUTES,
        startMinutes + 1,
    );

    return {
        eventId: eventDate,
        requestsOpenAt: zonedTimeToInstant(
            addDaysToDateKey(eventDate, -PICKUP_LEAD_DAYS),
            '00:00',
            timeZone,
        ),
        startsAt: zonedTimeToInstant(eventDate, minutesToTime(startMinutes), timeZone),
        endsAt: zonedTimeToInstant(eventDate, minutesToTime(safeEndMinutes), timeZone),
        dropoffOpensAt: zonedTimeToInstant(
            eventDate,
            minutesToTime(dropoffMinutes),
            timeZone,
        ),
        // Midnight at the end of the gathering's own day, so late drop-off runs
        // are not cut off by the clock.
        closesAt: zonedTimeToInstant(addDaysToDateKey(eventDate, 1), '00:00', timeZone),
        attendanceLocksAt: zonedTimeToInstant(
            addDaysToDateKey(eventDate, -1),
            ATTENDANCE_LOCK_HOUR,
            timeZone,
        ),
        venue: extras?.venue ?? null,
        agenda: extras?.agenda ?? '',
    };
}

/**
 * Parse "HH:MM" into minutes since midnight.
 *
 * Returns null on anything unparseable rather than guessing. A malformed
 * setting must not silently become 00:00, which would open drop-off all day.
 */
export function parseTimeToMinutes(value: unknown): number | null {
    if (typeof value !== 'string') return null;

    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return hours * 60 + minutes;
}

/** "19:00" → "7:00 PM", for display to riders. */
export function formatTimeForDisplay(value: string): string {
    const total = parseTimeToMinutes(value);
    if (total === null) return value;

    const hours24 = Math.floor(total / 60);
    const minutes = total % 60;
    const suffix = hours24 < 12 ? 'AM' : 'PM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

    return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/**
 * Which rides — if any — are open at this instant, for a given gathering.
 *
 * Compares `now` against the gathering's own absolute instants, so nothing here
 * cares what day of the week it is. That is what lets the date move.
 *
 * `event` null means nothing is scheduled — closed, and say so plainly rather
 * than guessing a date.
 */
export function resolveScheduleWindow(
    now: Date,
    event: CurrentEvent | null,
    timeZone: string,
): ScheduleWindow {
    if (!event) {
        return {
            rideType: null,
            displayText: 'No rides available',
            timeContext: 'No sabha is scheduled yet',
        };
    }

    const startsAt = new Date(event.startsAt);
    const dropoffOpensAt = new Date(event.dropoffOpensAt);
    const requestsOpenAt = new Date(event.requestsOpenAt);
    const closesAt = new Date(event.closesAt);

    const startLabel = formatInstantForDisplay(startsAt, timeZone);
    const dayLabel = formatDayForDisplay(startsAt, timeZone);

    if (now < requestsOpenAt) {
        return {
            rideType: null,
            displayText: 'No rides available',
            timeContext: `Ride requests open ${formatDayForDisplay(requestsOpenAt, timeZone)} for ${dayLabel}'s sabha`,
        };
    }

    if (now < startsAt) {
        return {
            rideType: 'home-to-sabha',
            displayText: 'Home → Sabha',
            timeContext: `Sabha ${dayLabel} at ${startLabel}`,
        };
    }

    if (now < dropoffOpensAt) {
        return {
            rideType: null,
            displayText: 'Sabha in Progress',
            timeContext: `Drop-off rides open ${DROPOFF_LEAD_MINUTES} minutes before sabha ends at ${formatInstantForDisplay(new Date(event.endsAt), timeZone)}`,
        };
    }

    if (now < closesAt) {
        return {
            rideType: 'sabha-to-home',
            displayText: 'Sabha → Home',
            timeContext: `Sabha ends at ${formatInstantForDisplay(new Date(event.endsAt), timeZone)}`,
        };
    }

    return {
        rideType: null,
        displayText: 'No rides available',
        timeContext: 'Rides for this sabha have closed',
    };
}

/** "7:00 PM" in the venue's zone. */
function formatInstantForDisplay(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(instant);
}

/** "Friday 14 Aug" in the venue's zone. */
function formatDayForDisplay(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone, weekday: 'long', day: 'numeric', month: 'short',
    }).format(instant);
}

/** Inverse of parseTimeToMinutes, for building display labels. */
function minutesToTime(total: number): string {
    const hours = Math.floor(total / 60) % 24;
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
