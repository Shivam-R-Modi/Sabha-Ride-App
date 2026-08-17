"use strict";
// ============================================
// The manager's recurring sabha, as a RULE.
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayOfWeekForKey = dayOfWeekForKey;
exports.toVenue = toVenue;
exports.normaliseRecurrence = normaliseRecurrence;
exports.normaliseException = normaliseException;
exports.coversDate = coversDate;
exports.occurrencesBetween = occurrencesBetween;
exports.effectiveEvent = effectiveEvent;
exports.upcomingOccurrences = upcomingOccurrences;
/**
 * The schedule is a rule. Documents are only the exceptions to it.
 *
 * WHAT THIS REPLACES, AND WHY
 * ---------------------------
 * The first version of this file MATERIALISED dates: it wrote one
 * `events/{date}` document per occurrence out to a horizon (`weeksAhead`, 1–26),
 * and kept a `generatedThrough` high-water mark so a date the manager deleted
 * could not be recreated on the next run.
 *
 * That worked, and it was the wrong shape. A weekly sabha is one fact — "every
 * Friday, 7:30 to 10" — and turning it into 26 rows meant the calendar showed 26
 * things a manager had to trust were all the same, a horizon that had to be
 * chosen for no reason, and a watermark whose only job was undoing the damage of
 * having generated at all.
 *
 * Now the rule is the source of truth and `events/{date}` documents are
 * exceptions: this Friday is cancelled, that Friday moved hall, or there is a
 * one-off on a Tuesday. Everything the manager did not touch follows the rule,
 * for ever, with no horizon.
 *
 * THE BUG CLASS THIS DELETES
 * --------------------------
 * The old model needed TWO guards against resurrection — the watermark for
 * deletions and an `occupied` set for cancellations — because it created
 * documents and therefore had to remember which it had already offered.
 *
 * Under a rule, "this Friday is cancelled" IS a document, and it persists by
 * existing. There is nothing to remember and nothing to resurrect. `weeksAhead`,
 * `generatedThrough`, `datesToGenerate`, `advanceWatermark` and `topUpCalendar`
 * are gone, and with them the whole class of bug where a deleted date came back
 * within 60 seconds.
 *
 * OVERRIDES ARE FULL SNAPSHOTS
 * ----------------------------
 * Settled with the owner on 2026-08-17: editing or cancelling one Friday affects
 * **only that week**, and the rule and every other week stay exactly as they
 * were. So an exception carries its own complete times and venue and does not
 * follow later changes to the rule. The alternative — storing only the fields
 * that differ, so an edited date still picks up a later rule time change — is
 * defensible, but needs the UI to track which fields were touched. The calendar
 * copy states which behaviour this is, because a manager cannot infer it.
 */
const time_1 = require("./time");
const schedule_1 = require("./schedule");
/** Day-of-week for a `YYYY-MM-DD` key, read at UTC noon so no DST edge shifts it. */
function dayOfWeekForKey(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}
/** A venue needs both coordinates, and 0,0 is not a venue. */
function toVenue(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const v = raw;
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number')
        return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng))
        return null;
    if (v.lat === 0 && v.lng === 0)
        return null;
    return {
        lat: v.lat,
        lng: v.lng,
        address: typeof v.address === 'string' ? v.address : '',
    };
}
/**
 * Validate and clean the stored rule.
 *
 * Returns null rather than a partly-repaired object when the pattern cannot be
 * understood. This is read by the per-minute scheduler, and a half-read rule that
 * puts sabha on the wrong day is worse than one that puts it nowhere: a missing
 * gathering is visible to a manager, a wrong one sends drivers out.
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
    return {
        enabled: r.enabled === true,
        daysOfWeek: days,
        startTime,
        endTime,
        venue: toVenue(r.venue),
        agenda: typeof r.agenda === 'string' ? r.agenda : '',
    };
}
/** Normalise a stored exception document. Null when it cannot be used. */
function normaliseException(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const e = raw;
    const start = typeof e.startTime === 'string' ? e.startTime : '';
    const end = typeof e.endTime === 'string' ? e.endTime : '';
    const startMin = (0, schedule_1.parseTimeToMinutes)(start);
    const endMin = (0, schedule_1.parseTimeToMinutes)(end);
    const usableTimes = startMin !== null && endMin !== null && endMin > startMin;
    const status = e.status === 'cancelled' ? 'cancelled' : 'scheduled';
    // A cancellation needs no usable times — it cancels. Anything else without
    // them cannot describe a gathering, so it is not treated as one.
    if (status === 'scheduled' && !usableTimes)
        return null;
    return {
        // Absent `kind` means a document written before this model existed.
        // Treated as an override, the conservative reading: it then only affects a
        // date the rule already covers, and on any other date it is inert rather
        // than silently creating a gathering nobody scheduled.
        kind: e.kind === 'one-off' ? 'one-off' : 'override',
        status,
        startTime: usableTimes ? start : '',
        endTime: usableTimes ? end : '',
        venue: toVenue(e.venue),
        agenda: typeof e.agenda === 'string' ? e.agenda : '',
    };
}
/** Does the rule place a gathering on this date? */
function coversDate(rule, dateKey) {
    if (!(rule === null || rule === void 0 ? void 0 : rule.enabled))
        return false;
    return rule.daysOfWeek.includes(dayOfWeekForKey(dateKey));
}
/**
 * Every date the rule covers in `[fromKey, toKey]`, inclusive.
 *
 * Replaces `datesToGenerate`. Note what is not here: no watermark, no set of
 * occupied dates, no side effects. It answers a question about a rule instead of
 * deciding what to write.
 */
function occurrencesBetween(rule, fromKey, toKey) {
    if (!(rule === null || rule === void 0 ? void 0 : rule.enabled))
        return [];
    if (fromKey > toKey)
        return [];
    const wanted = new Set(rule.daysOfWeek);
    const out = [];
    for (let cursor = fromKey; cursor <= toKey; cursor = (0, time_1.addDaysToDateKey)(cursor, 1)) {
        if (wanted.has(dayOfWeekForKey(cursor)))
            out.push(cursor);
    }
    return out;
}
/**
 * What is actually happening on this date, rule and exception combined.
 *
 * Pure, and the whole of the risk — the single answer to "is there a sabha, and
 * when". Asserted directly rather than through a Firestore fake.
 *
 * Priority:
 *
 *  1. a cancellation beats everything — nothing happens that day
 *  2. a one-off stands alone, whether or not the rule covers the date
 *  3. an override replaces the rule occurrence: times, venue and all
 *  4. otherwise the rule, if it covers the date
 *  5. otherwise nothing
 *
 * An override on a date the rule does NOT cover is inert. That is what makes
 * turning the rule off safe — overrides stop applying rather than becoming
 * phantom gatherings, and they apply again if the rule comes back.
 */
function effectiveEvent(dateKey, rule, exception) {
    if ((exception === null || exception === void 0 ? void 0 : exception.status) === 'cancelled')
        return null;
    if ((exception === null || exception === void 0 ? void 0 : exception.kind) === 'one-off') {
        return {
            date: dateKey,
            startTime: exception.startTime,
            endTime: exception.endTime,
            venue: exception.venue,
            agenda: exception.agenda,
            source: 'one-off',
        };
    }
    const covered = coversDate(rule, dateKey);
    if ((exception === null || exception === void 0 ? void 0 : exception.kind) === 'override') {
        if (!covered)
            return null; // inert off-pattern — see the note above
        return {
            date: dateKey,
            startTime: exception.startTime,
            endTime: exception.endTime,
            venue: exception.venue,
            agenda: exception.agenda,
            source: 'override',
        };
    }
    if (!covered || !rule)
        return null;
    return {
        date: dateKey,
        startTime: rule.startTime,
        endTime: rule.endTime,
        venue: rule.venue,
        agenda: rule.agenda,
        source: 'rule',
    };
}
/**
 * The next occurrences from `fromKey` onward, exceptions applied, cancellations
 * removed.
 *
 * Used by the scheduler to find the current gathering AND by the manager's
 * calendar to list what is coming — one function, so the two cannot disagree
 * about what the schedule says. The scheduler asks for 1, the calendar for ~8.
 *
 * @param exceptions keyed by date, as read from the events collection.
 */
function upcomingOccurrences(rule, exceptions, fromKey, toKey, limit) {
    var _a;
    // Rule dates and one-off dates together, in order, de-duplicated. A one-off
    // sits on a date the rule does not cover, so a walk driven by the rule alone
    // would never see it.
    const candidates = new Set(occurrencesBetween(rule, fromKey, toKey));
    for (const [date, exception] of exceptions) {
        if (date >= fromKey && date <= toKey && exception.kind === 'one-off') {
            candidates.add(date);
        }
    }
    const out = [];
    for (const date of [...candidates].sort()) {
        const occurrence = effectiveEvent(date, rule, (_a = exceptions.get(date)) !== null && _a !== void 0 ? _a : null);
        if (occurrence)
            out.push(occurrence);
        if (out.length >= limit)
            break;
    }
    return out;
}
//# sourceMappingURL=recurrence.js.map