"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATTENDANCE_LOCK_HOUR = exports.DEFAULT_SABHA_END = exports.DEFAULT_SABHA_START = exports.DROPOFF_LEAD_MINUTES = exports.PICKUP_LEAD_DAYS = void 0;
exports.buildCurrentEvent = buildCurrentEvent;
exports.parseTimeToMinutes = parseTimeToMinutes;
exports.formatTimeForDisplay = formatTimeForDisplay;
exports.resolveScheduleWindow = resolveScheduleWindow;
const time_1 = require("./time");
/**
 * Ride requests open this many days before the gathering.
 *
 * Was the constant "Wednesday". Expressed as a lead time it means the same thing
 * for a Friday sabha and keeps working when the date moves, which it now can.
 */
exports.PICKUP_LEAD_DAYS = 2;
/*
 * `SABHA_DAY = 5 // Friday` used to live here. It is deleted, not moved.
 *
 * Its comment already recorded it as no longer the source of truth — "only the
 * default slot new events are generated in" — and then the weekly template that
 * generated them was itself deleted in the move to a recurrence rule. So it was
 * an exported hardcoded Friday with zero consumers, sitting in the one file a
 * future reader would go to when asking "which day is sabha".
 *
 * There is exactly one answer to that now: `settings/sabhaRecurrence.daysOfWeek`,
 * set by a manager, read live. Nothing in this codebase may name a weekday for
 * scheduling — see tests/quality/schedule-not-hardcoded.test.ts.
 */
/** Drop-off opens this many minutes before sabha ends. */
exports.DROPOFF_LEAD_MINUTES = 15;
exports.DEFAULT_SABHA_START = '19:00';
exports.DEFAULT_SABHA_END = '22:00';
/**
 * Attendance closes at this hour, on the day before the gathering.
 * Once past it, a "yes" cannot be withdrawn — drivers are already planned
 * around it.
 */
exports.ATTENDANCE_LOCK_HOUR = '18:00';
/**
 * Turn a gathering's date and times into the absolute instants everything else
 * compares against.
 *
 * The date is now given, not derived — it comes from the events collection. This
 * function used to work out "the upcoming Friday" itself, which is exactly the
 * assumption that made the day unchangeable.
 */
function buildCurrentEvent(eventDate, startTime, endTime, timeZone, extras) {
    var _a, _b, _c, _d;
    const startMinutes = (_a = parseTimeToMinutes(startTime)) !== null && _a !== void 0 ? _a : parseTimeToMinutes(exports.DEFAULT_SABHA_START);
    const endMinutes = (_b = parseTimeToMinutes(endTime)) !== null && _b !== void 0 ? _b : parseTimeToMinutes(exports.DEFAULT_SABHA_END);
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
    const dropoffMinutes = Math.max(safeEndMinutes - exports.DROPOFF_LEAD_MINUTES, startMinutes + 1);
    return {
        eventId: eventDate,
        requestsOpenAt: (0, time_1.zonedTimeToInstant)((0, time_1.addDaysToDateKey)(eventDate, -exports.PICKUP_LEAD_DAYS), '00:00', timeZone),
        startsAt: (0, time_1.zonedTimeToInstant)(eventDate, minutesToTime(startMinutes), timeZone),
        endsAt: (0, time_1.zonedTimeToInstant)(eventDate, minutesToTime(safeEndMinutes), timeZone),
        dropoffOpensAt: (0, time_1.zonedTimeToInstant)(eventDate, minutesToTime(dropoffMinutes), timeZone),
        // Midnight at the end of the gathering's own day, so late drop-off runs
        // are not cut off by the clock.
        closesAt: (0, time_1.zonedTimeToInstant)((0, time_1.addDaysToDateKey)(eventDate, 1), '00:00', timeZone),
        attendanceLocksAt: (0, time_1.zonedTimeToInstant)((0, time_1.addDaysToDateKey)(eventDate, -1), exports.ATTENDANCE_LOCK_HOUR, timeZone),
        venue: (_c = extras === null || extras === void 0 ? void 0 : extras.venue) !== null && _c !== void 0 ? _c : null,
        agenda: (_d = extras === null || extras === void 0 ? void 0 : extras.agenda) !== null && _d !== void 0 ? _d : '',
    };
}
/**
 * Parse "HH:MM" into minutes since midnight.
 *
 * Returns null on anything unparseable rather than guessing. A malformed
 * setting must not silently become 00:00, which would open drop-off all day.
 */
function parseTimeToMinutes(value) {
    if (typeof value !== 'string')
        return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match)
        return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59)
        return null;
    return hours * 60 + minutes;
}
/** "19:00" → "7:00 PM", for display to riders. */
function formatTimeForDisplay(value) {
    const total = parseTimeToMinutes(value);
    if (total === null)
        return value;
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
function resolveScheduleWindow(now, event, timeZone) {
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
            timeContext: `Drop-off rides open ${exports.DROPOFF_LEAD_MINUTES} minutes before sabha ends at ${formatInstantForDisplay(new Date(event.endsAt), timeZone)}`,
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
function formatInstantForDisplay(instant, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(instant);
}
/** "Friday 14 Aug" in the venue's zone. */
function formatDayForDisplay(instant, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone, weekday: 'long', day: 'numeric', month: 'short',
    }).format(instant);
}
/** Inverse of parseTimeToMinutes, for building display labels. */
function minutesToTime(total) {
    const hours = Math.floor(total / 60) % 24;
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
//# sourceMappingURL=schedule.js.map