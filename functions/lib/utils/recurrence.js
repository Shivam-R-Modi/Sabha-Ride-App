"use strict";
// ============================================
// The manager's recurring sabha schedule.
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WEEKS_AHEAD = exports.MIN_WEEKS_AHEAD = exports.MAX_WEEKS_AHEAD = void 0;
exports.dayOfWeekForKey = dayOfWeekForKey;
exports.normaliseRecurrence = normaliseRecurrence;
exports.datesToGenerate = datesToGenerate;
exports.advanceWatermark = advanceWatermark;
/**
 * A congregation that meets every Friday should not need somebody to remember.
 *
 * Until this existed, `seedFirstEventIfNeeded` created exactly one gathering on a
 * brand-new project and then never ran again — deliberately, because the calendar
 * belongs to the manager. The consequence was that the calendar ran dry: measured
 * on 2026-08-15, `system/rideContext` read `calendarStatus:
 * 'no-scheduled-event'` and nobody could request a ride at all until a manager
 * hand-added a date.
 *
 * So the pattern is now the manager's to set, and topping the calendar up from it
 * is the machine's job.
 *
 * THE INVARIANT THIS MUST NOT BREAK
 * ---------------------------------
 * **A date the manager removed must never come back.** An earlier version of the
 * seeder decided whether a slot had been "dealt with" by whether a document
 * existed there, so deleting a date erased the evidence and the per-minute
 * self-heal recreated it within 60 seconds. Two separate guards keep that from
 * returning:
 *
 *  1. `generatedThrough` — a high-water mark that only ever moves forward. A date
 *     at or before it has already been offered once and is never offered again,
 *     whatever the calendar now looks like.
 *  2. `occupied` — any date that already holds a document is skipped, which covers
 *     *cancelled* gatherings (the document survives with `status: 'cancelled'`)
 *     and also keeps `batch.create`'s ALREADY_EXISTS precondition from rejecting
 *     a whole commit.
 *
 * Guard 1 covers deletion, guard 2 covers cancellation. Neither is redundant.
 *
 * Because the watermark never rolls backwards, **editing the pattern affects
 * dates not yet on the calendar** — it does not retroactively add or move ones
 * already decided. The UI says so in those words.
 */
const time_1 = require("./time");
const schedule_1 = require("./schedule");
/**
 * Upper bound on the horizon.
 *
 * Six months. Not a performance limit — it is how far ahead it is honest to claim
 * a gathering will happen. A calendar filled two years out is a promise nobody
 * made, and every one of those dates is a document a manager may have to cancel
 * by hand.
 */
exports.MAX_WEEKS_AHEAD = 26;
exports.MIN_WEEKS_AHEAD = 1;
exports.DEFAULT_WEEKS_AHEAD = 6;
/** Day-of-week for a `YYYY-MM-DD` key, read at UTC noon so no DST edge can shift it. */
function dayOfWeekForKey(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}
/**
 * Validate and clean whatever is in the settings document.
 *
 * Returns null rather than a partly-repaired object when the pattern could not be
 * understood. This runs inside a scheduled job, and a half-read config that
 * generates gatherings on the wrong day is worse than one that generates none:
 * a missing date is visible to a manager, a wrong one sends drivers out.
 */
function normaliseRecurrence(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const days = Array.isArray(r.daysOfWeek)
        ? [...new Set(r.daysOfWeek.filter((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))]
            .sort((a, b) => a - b)
        : [];
    if (days.length === 0)
        return null;
    const startTime = typeof r.startTime === 'string' ? r.startTime : '';
    const endTime = typeof r.endTime === 'string' ? r.endTime : '';
    const start = (0, schedule_1.parseTimeToMinutes)(startTime);
    const end = (0, schedule_1.parseTimeToMinutes)(endTime);
    if (start === null || end === null || end <= start)
        return null;
    const weeksRaw = typeof r.weeksAhead === 'number' ? Math.floor(r.weeksAhead) : exports.DEFAULT_WEEKS_AHEAD;
    const weeksAhead = Math.min(exports.MAX_WEEKS_AHEAD, Math.max(exports.MIN_WEEKS_AHEAD, weeksRaw));
    const mark = r.generatedThrough;
    const generatedThrough = typeof mark === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mark)
        ? mark
        : null;
    return {
        enabled: r.enabled === true,
        daysOfWeek: days,
        startTime,
        endTime,
        weeksAhead,
        generatedThrough,
    };
}
/**
 * Which dates should be created right now.
 *
 * Pure, and the whole of the risk: this decides what appears on a congregation's
 * calendar. Asserted directly rather than through the scheduled wrapper.
 *
 * @param occupied every date already holding a document, cancelled ones included.
 */
function datesToGenerate(config, now, timeZone, occupied) {
    if (!config.enabled)
        return [];
    const today = (0, time_1.zonedDateKey)(now, timeZone);
    const horizon = (0, time_1.addDaysToDateKey)(today, config.weeksAhead * 7);
    // Start the day after the watermark, or today if there is none. Today itself
    // is eligible: a manager enabling this on a Friday afternoon should get that
    // evening's sabha, not next week's.
    const mark = config.generatedThrough;
    const from = mark && mark >= today ? (0, time_1.addDaysToDateKey)(mark, 1) : today;
    const wanted = new Set(config.daysOfWeek);
    const out = [];
    for (let cursor = from; cursor <= horizon; cursor = (0, time_1.addDaysToDateKey)(cursor, 1)) {
        if (!wanted.has(dayOfWeekForKey(cursor)))
            continue;
        if (occupied.has(cursor))
            continue;
        out.push(cursor);
    }
    return out;
}
/**
 * Where the watermark should sit after a run.
 *
 * The horizon, not the last date created — otherwise a week the manager had
 * already filled by hand would leave the mark short, and the dates between it and
 * the horizon would be offered again on the next run.
 *
 * Never moves backwards. A shrunk `weeksAhead` must not re-open dates that were
 * already decided.
 */
function advanceWatermark(config, now, timeZone) {
    const horizon = (0, time_1.addDaysToDateKey)((0, time_1.zonedDateKey)(now, timeZone), config.weeksAhead * 7);
    const current = config.generatedThrough;
    return current && current > horizon ? current : horizon;
}
//# sourceMappingURL=recurrence.js.map