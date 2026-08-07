/**
 * When rides are open, derived from times a manager sets.
 *
 * Previously every boundary was a literal in updateRideTypeContext: Friday only,
 * pickup before 19:00, drop-off from 22:00. Changing the sabha time meant a code
 * edit and a deploy, which is not something a coordinator can do on a Thursday.
 *
 * The manager now sets two things — when sabha starts and when it ends. Both are
 * "HH:MM" in Sabha local time. Everything else is derived:
 *
 *   Wed 00:00  ──────────────────────────►  pickup open (home → sabha)
 *   Fri <start>                              sabha in progress, no rides
 *   Fri <end − 15min> ──────────────────►  drop-off open (sabha → home)
 *   Sat 00:00                                closed
 *
 * Drop-off deliberately opens 15 minutes BEFORE sabha ends, so drivers are
 * moving before the hall empties rather than after.
 */

import {
    getZonedParts, zonedDateKey, addDaysToDateKey, zonedTimeToInstant,
} from './time';
import type { RideType } from '../types';

/** 0 = Sunday. Pickups open at the start of this day. */
export const PICKUP_OPENS_DAY = 3; // Wednesday

/** 0 = Sunday. The day sabha is held. */
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
    startsAt: string;
    endsAt: string;
    /** Drop-off rides open here, 15 minutes before the end. */
    dropoffOpensAt: string;
    /** After this, a "yes" is committed. */
    attendanceLocksAt: string;
}

/**
 * Which gathering are we working towards right now?
 *
 * The upcoming sabha, or today's if today is the sabha day. Saturday rolls
 * forward to next week, which preserves the existing "Saturday 00:00 to Friday
 * 23:59" cycle the attendance records were already keyed by — so no historical
 * record is orphaned by this change.
 */
export function resolveCurrentEvent(
    now: Date,
    timeZone: string,
    sabhaStart: unknown,
    sabhaEnd: unknown,
): CurrentEvent {
    const { dayOfWeek } = getZonedParts(now, timeZone);

    // 0 when today IS the sabha day, so Friday keeps pointing at itself all day.
    const daysUntilSabha = (SABHA_DAY - dayOfWeek + 7) % 7;
    const eventId = addDaysToDateKey(zonedDateKey(now, timeZone), daysUntilSabha);

    const startMinutes = parseTimeToMinutes(sabhaStart)
        ?? parseTimeToMinutes(DEFAULT_SABHA_START)!;
    const endMinutes = parseTimeToMinutes(sabhaEnd)
        ?? parseTimeToMinutes(DEFAULT_SABHA_END)!;
    const safeEndMinutes = endMinutes > startMinutes ? endMinutes : startMinutes + 60;

    return {
        eventId,
        startsAt: zonedTimeToInstant(eventId, minutesToTime(startMinutes), timeZone),
        endsAt: zonedTimeToInstant(eventId, minutesToTime(safeEndMinutes), timeZone),
        dropoffOpensAt: zonedTimeToInstant(
            eventId,
            minutesToTime(safeEndMinutes - DROPOFF_LEAD_MINUTES),
            timeZone,
        ),
        attendanceLocksAt: zonedTimeToInstant(
            addDaysToDateKey(eventId, -1),
            ATTENDANCE_LOCK_HOUR,
            timeZone,
        ),
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
 * Which rides — if any — are open at this instant.
 *
 * Falls back to the default times when a setting is missing or malformed. The
 * failure mode of throwing here is "no rides at all", which strands people, so
 * a bad value degrades to the previous behaviour instead.
 */
export function resolveScheduleWindow(
    now: Date,
    timeZone: string,
    sabhaStart: unknown,
    sabhaEnd: unknown,
): ScheduleWindow {
    const { dayOfWeek, hour, minute } = getZonedParts(now, timeZone);
    const nowMinutes = hour * 60 + minute;

    const startMinutes = parseTimeToMinutes(sabhaStart)
        ?? parseTimeToMinutes(DEFAULT_SABHA_START)!;
    const endMinutes = parseTimeToMinutes(sabhaEnd)
        ?? parseTimeToMinutes(DEFAULT_SABHA_END)!;

    // A manager who sets an end time at or before the start would otherwise
    // produce a negative-length sabha and open drop-off before pickup closes.
    const safeEndMinutes = endMinutes > startMinutes ? endMinutes : startMinutes + 60;
    const dropoffFrom = safeEndMinutes - DROPOFF_LEAD_MINUTES;

    const startLabel = formatTimeForDisplay(minutesToTime(startMinutes));
    const endLabel = formatTimeForDisplay(minutesToTime(safeEndMinutes));

    // Wednesday and Thursday: pickup is open all day.
    if (dayOfWeek === PICKUP_OPENS_DAY || dayOfWeek === PICKUP_OPENS_DAY + 1) {
        return {
            rideType: 'home-to-sabha',
            displayText: 'Home → Sabha',
            timeContext: `Requesting is open for Friday's sabha (${startLabel})`,
        };
    }

    if (dayOfWeek === SABHA_DAY) {
        if (nowMinutes < startMinutes) {
            return {
                rideType: 'home-to-sabha',
                displayText: 'Home → Sabha',
                timeContext: `Sabha starts at ${startLabel}`,
            };
        }

        if (nowMinutes < dropoffFrom) {
            return {
                rideType: null,
                displayText: 'Sabha in Progress',
                timeContext: `Drop-off rides open ${DROPOFF_LEAD_MINUTES} minutes before sabha ends at ${endLabel}`,
            };
        }

        return {
            rideType: 'sabha-to-home',
            displayText: 'Sabha → Home',
            timeContext: `Sabha ends at ${endLabel}`,
        };
    }

    return {
        rideType: null,
        displayText: 'No rides available',
        timeContext: 'Ride requests open Wednesday',
    };
}

/** Inverse of parseTimeToMinutes, for building display labels. */
function minutesToTime(total: number): string {
    const hours = Math.floor(total / 60) % 24;
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
