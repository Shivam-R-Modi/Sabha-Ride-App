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
//# sourceMappingURL=time.js.map