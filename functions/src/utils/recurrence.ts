// ============================================
// The manager's recurring sabha, as a RULE.
// ============================================

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

import { addDaysToDateKey } from './time';
import { parseTimeToMinutes } from './schedule';

export interface Venue {
    lat: number;
    lng: number;
    address: string;
}

/** The rule. One record, no horizon, repeats until a manager changes it. */
export interface RecurrenceRule {
    enabled: boolean;
    /** 0 = Sunday … 6 = Saturday. More than one is allowed. */
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    /** Default venue for occurrences. Null means fall back to settings/main. */
    venue: Venue | null;
    agenda: string;
}

/** How a date diverges from the rule. */
export type ExceptionKind =
    /** A rule occurrence the manager edited or cancelled. */
    | 'override'
    /** A gathering on a date the rule does not cover. */
    | 'one-off';

export interface EventException {
    kind: ExceptionKind;
    status: 'scheduled' | 'cancelled';
    startTime: string;
    endTime: string;
    venue: Venue | null;
    agenda: string;
}

/** What is actually happening on a given date. */
export interface Occurrence {
    date: string;
    startTime: string;
    endTime: string;
    venue: Venue | null;
    agenda: string;
    /** Where this came from — for the calendar to label, and for debugging. */
    /**
     * `hall-override` means one hall's own document changed this date's times or
     * venue. See `effectiveEventFor`.
     */
    source: 'rule' | 'override' | 'one-off' | 'hall-override';
}

/**
 * A bare `YYYY-MM-DD` key, as opposed to a suffixed multi-hall event id.
 *
 * One predicate, because both users of it are load-bearing: `dayOfWeekForKey` and the
 * candidate walk in `upcomingOccurrences`.
 */
export function isDateKey(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Day-of-week for a `YYYY-MM-DD` key, read at UTC noon so no DST edge shifts it.
 *
 * RETURNS -1 FOR ANYTHING THAT IS NOT A BARE DATE KEY. An event id can now be
 * `2026-08-07__somerville`, and `.split('-').map(Number)` on that yields
 * `[2026, 8, NaN]` → an Invalid Date → NaN, which `daysOfWeek.includes` reads as
 * false. That makes the date look like it is LOSING ITS SABHA, and `reconcileDate`
 * in sabhaRecurrence.ts then CANCELS ITS RIDES — a hall's whole evening of Bhulka
 * dropped by a scheduler, with nothing in the logs saying why. -1 matches no
 * weekday, so the answer is unchanged for a real date; the difference is that it is
 * false for a stated reason rather than by accident.
 */
export function dayOfWeekForKey(dateKey: string): number {
    if (!isDateKey(dateKey)) return -1;
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

/** A venue needs both coordinates, and 0,0 is not a venue. */
export function toVenue(raw: unknown): Venue | null {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Record<string, unknown>;
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return null;
    if (v.lat === 0 && v.lng === 0) return null;
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
export function normaliseRecurrence(raw: unknown): RecurrenceRule | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const days = Array.isArray(r.daysOfWeek)
        ? [...new Set(r.daysOfWeek.filter(
            (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))]
            .sort((a, b) => a - b)
        : [];
    if (days.length === 0) return null;

    const startTime = typeof r.startTime === 'string' ? r.startTime : '';
    const endTime = typeof r.endTime === 'string' ? r.endTime : '';
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    if (start === null || end === null || end <= start) return null;

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
export function normaliseException(raw: unknown): EventException | null {
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as Record<string, unknown>;

    const start = typeof e.startTime === 'string' ? e.startTime : '';
    const end = typeof e.endTime === 'string' ? e.endTime : '';
    const startMin = parseTimeToMinutes(start);
    const endMin = parseTimeToMinutes(end);
    const usableTimes = startMin !== null && endMin !== null && endMin > startMin;

    const status = e.status === 'cancelled' ? 'cancelled' : 'scheduled';

    // A cancellation needs no usable times — it cancels. Anything else without
    // them cannot describe a gathering, so it is not treated as one.
    if (status === 'scheduled' && !usableTimes) return null;

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
export function coversDate(rule: RecurrenceRule | null, dateKey: string): boolean {
    if (!rule?.enabled) return false;
    return rule.daysOfWeek.includes(dayOfWeekForKey(dateKey));
}

/**
 * Every date the rule covers in `[fromKey, toKey]`, inclusive.
 *
 * Replaces `datesToGenerate`. Note what is not here: no watermark, no set of
 * occupied dates, no side effects. It answers a question about a rule instead of
 * deciding what to write.
 */
export function occurrencesBetween(
    rule: RecurrenceRule | null,
    fromKey: string,
    toKey: string,
): string[] {
    if (!rule?.enabled) return [];
    if (fromKey > toKey) return [];

    const wanted = new Set(rule.daysOfWeek);
    const out: string[] = [];

    for (let cursor = fromKey; cursor <= toKey; cursor = addDaysToDateKey(cursor, 1)) {
        if (wanted.has(dayOfWeekForKey(cursor))) out.push(cursor);
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
export function effectiveEvent(
    dateKey: string,
    rule: RecurrenceRule | null,
    exception: EventException | null,
): Occurrence | null {
    if (exception?.status === 'cancelled') return null;

    if (exception?.kind === 'one-off') {
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

    if (exception?.kind === 'override') {
        if (!covered) return null; // inert off-pattern — see the note above
        return {
            date: dateKey,
            startTime: exception.startTime,
            endTime: exception.endTime,
            venue: exception.venue,
            agenda: exception.agenda,
            source: 'override',
        };
    }

    if (!covered || !rule) return null;

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
 * What ONE HALL says on top of an evening that is already resolved.
 *
 * Split out of `effectiveEventFor` because the ride-context scheduler needs exactly
 * this half: it has already resolved the evening once, for everyone, and only needs to
 * lay each hall's own document over it. Two implementations of a merge this quiet would
 * drift, and the drift would be one hall running at the other hall's time.
 *
 * Generic over the shape so it works on an `Occurrence` and on the scheduler's own
 * event record without either of them having to become the other.
 */
export function applyHallException<T extends {
    startTime: string; endTime: string; venue: Venue | null; agenda: string;
}>(
    base: T | null,
    hallException: EventException | null,
): T | null {
    // "Not this hall tonight" — and a cancelled evening is already a null base, so
    // cancelling the whole date beating one hall's own plans falls out for free.
    if (hallException?.status === 'cancelled' || !base) return null;
    if (!hallException) return base;

    return {
        ...base,
        // Each field falls back to the evening's own value, so a hall that only moves
        // its time does not have to restate the venue and the agenda — which is what a
        // manager changing one hall's start time actually does.
        //
        // The two time fallbacks are unreachable through `normaliseException`, which
        // refuses a scheduled exception without BOTH times; they are here for a
        // hand-built record, and because an event at startTime `''` is the worse of
        // the two failures. `venue` uses `??` not `||` because null means "no
        // override" and must reach `resolveVenue` — that is what picks the hall's own
        // standing venue, and `||` would turn a deliberate null into the same thing
        // by accident while also swallowing a future empty-object venue.
        startTime: hallException.startTime || base.startTime,
        endTime: hallException.endTime || base.endTime,
        venue: hallException.venue ?? base.venue,
        agenda: hallException.agenda || base.agenda,
    };
}

/**
 * What is happening AT ONE HALL on a given date.
 *
 * THREE LAYERS, extending the two the date already had:
 * `hall exception → date exception → rule`. The date layer is unchanged and still
 * resolved by `effectiveEvent`; this only adds what one hall says on top.
 *
 * A HALL EXCEPTION IS ALWAYS AN OVERRIDE, never a one-off. Both halls run the same
 * evening — that is the arrangement this was built for — so a hall document says one
 * of two things: "not this hall tonight", or "this hall at a different time". It never
 * says "this hall meets on a day the congregation does not", which is why a hall
 * exception on a date with no gathering is INERT rather than conjuring one. Same
 * principle as an override on a date the rule does not cover, and for the same reason:
 * turning the rule off must make exceptions stop applying, not become phantoms.
 */
export function effectiveEventFor(
    dateKey: string,
    rule: RecurrenceRule | null,
    dateException: EventException | null,
    hallException: EventException | null,
): Occurrence | null {
    const out = applyHallException(
        effectiveEvent(dateKey, rule, dateException), hallException,
    );
    // `source` says why a calendar row looks the way it does, so it names the hall
    // layer when the hall layer changed something — and does not when it did not.
    return out && hallException ? { ...out, source: 'hall-override' } : out;
}

/**
 * Of the dates that already hold bookings, the ones where nothing happens now.
 *
 * Moving the sabha day strands whoever booked the old one. Production, 2026-08-24:
 * the day moved Friday -> Monday and two riders who had already answered "yes"
 * for Friday the 28th stayed attached to it, so the gathering that actually ran
 * counted nobody, and a ride request sat on a date dispatch could never serve.
 *
 * Driven by where the bookings ARE rather than by a window of rule dates, which
 * is why it needs neither a horizon nor the previous rule. A cancellation strands
 * people just as a day change does, and this answers both.
 *
 * Note it asks `effectiveEvent`, not `coversDate`: a one-off deliberately sits on
 * a date the rule does not cover, and flagging it would tell the manager to move
 * people off a sabha that is going ahead.
 */
export function datesLosingTheirSabha(
    rule: RecurrenceRule | null,
    booked: readonly { dateKey: string; exception: EventException | null }[],
): string[] {
    return booked
        .filter(({ dateKey, exception }) => !effectiveEvent(dateKey, rule, exception))
        .map(({ dateKey }) => dateKey);
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
export function upcomingOccurrences(
    rule: RecurrenceRule | null,
    exceptions: ReadonlyMap<string, EventException>,
    fromKey: string,
    toKey: string,
    limit: number,
): Occurrence[] {
    // Rule dates and one-off dates together, in order, de-duplicated. A one-off
    // sits on a date the rule does not cover, so a walk driven by the rule alone
    // would never see it.
    const candidates = new Set(occurrencesBetween(rule, fromKey, toKey));
    for (const [date, exception] of exceptions) {
        // A SUFFIXED ID IS NOT A DATE, and this loop is the one place it could pass
        // for one. `exceptions` is keyed by document id, and a hall's document id is
        // `${dateKey}__${locationId}`; add that to the candidate set and
        // `effectiveEvent` hands back an Occurrence whose `date` IS the suffixed
        // string, which then travels out as `rideContext.eventId` and becomes the
        // attendance key. Sorting puts it directly after its own bare date, so it
        // would be picked first on any evening the date itself was cancelled.
        if (!isDateKey(date)) continue;
        if (date >= fromKey && date <= toKey && exception.kind === 'one-off') {
            candidates.add(date);
        }
    }

    const out: Occurrence[] = [];
    for (const date of [...candidates].sort()) {
        const occurrence = effectiveEvent(date, rule, exceptions.get(date) ?? null);
        if (occurrence) out.push(occurrence);
        if (out.length >= limit) break;
    }
    return out;
}
