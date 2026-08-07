"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TIME_ZONE = void 0;
exports.isValidTimeZone = isValidTimeZone;
exports.getZonedParts = getZonedParts;
exports.minutesSinceMidnight = minutesSinceMidnight;
exports.zonedTimeToInstant = zonedTimeToInstant;
exports.zonedDateKey = zonedDateKey;
exports.addDaysToDateKey = addDaysToDateKey;
/**
 * Default Sabha timezone. Stage 1 moves this into `settings/schedule` so a
 * manager can change it; until then it is the single place it is written down.
 */
exports.DEFAULT_TIME_ZONE = 'America/New_York';
const WEEKDAY_INDEX = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};
/** True if the runtime's ICU data recognises this IANA identifier. */
function isValidTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    }
    catch (_a) {
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
function getZonedParts(date, timeZone = exports.DEFAULT_TIME_ZONE) {
    var _a;
    let zone = timeZone;
    if (!isValidTimeZone(zone)) {
        console.warn(`[time] Unknown time zone "${timeZone}" — falling back to ${exports.DEFAULT_TIME_ZONE}`);
        zone = exports.DEFAULT_TIME_ZONE;
    }
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        // h23 keeps midnight as 00 rather than 24, which hour12:false can emit.
        hourCycle: 'h23',
    }).formatToParts(date);
    const valueOf = (type) => { var _a, _b; return (_b = (_a = parts.find((p) => p.type === type)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : ''; };
    return {
        dayOfWeek: (_a = WEEKDAY_INDEX[valueOf('weekday')]) !== null && _a !== void 0 ? _a : 0,
        hour: Number(valueOf('hour')),
        minute: Number(valueOf('minute')),
    };
}
/** Minutes since local midnight — convenient for window comparisons. */
function minutesSinceMidnight(date, timeZone = exports.DEFAULT_TIME_ZONE) {
    const { hour, minute } = getZonedParts(date, timeZone);
    return hour * 60 + minute;
}
/** How far `timeZone` is from UTC at this instant, in milliseconds. */
function zoneOffsetMs(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const valueOf = (type) => { var _a, _b; return Number((_b = (_a = parts.find((p) => p.type === type)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : 0); };
    const asIfUtc = Date.UTC(valueOf('year'), valueOf('month') - 1, valueOf('day'), valueOf('hour'), valueOf('minute'), valueOf('second'));
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
function zonedTimeToInstant(dateKey, hhmm, timeZone = exports.DEFAULT_TIME_ZONE) {
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
function zonedDateKey(date, timeZone = exports.DEFAULT_TIME_ZONE) {
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
function addDaysToDateKey(dateKey, days) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    const pad = (n) => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
//# sourceMappingURL=time.js.map