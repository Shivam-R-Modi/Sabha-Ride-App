/**
 * The recurring sabha rule — client mirror of functions/src/utils/recurrence.ts.
 *
 * Separate tsconfigs and no shared path, so the logic exists twice. The repo
 * already mirrors constants this way (src/constants/seats.ts), but occurrence
 * maths is much easier to get subtly wrong than three integers, and the failure
 * mode is worse: the two copies disagreeing means a rider is shown one date while
 * dispatch works towards another.
 *
 * So both sides are pinned to the SAME test vectors,
 * `tests/fixtures/recurrence-vectors.json`. A drift in either copy fails on both
 * sides. Change one of these files and you must change the other.
 *
 * See the server copy for the full reasoning — why the schedule is a rule rather
 * than generated documents, and why that deleted the whole watermark bug class.
 * The short version: `settings/sabhaRecurrence` is the schedule, `events/{date}`
 * documents are only its exceptions, and editing one Friday affects only that
 * Friday.
 */

export interface Venue {
    lat: number;
    lng: number;
    address: string;
}

export interface RecurrenceRule {
    enabled: boolean;
    /** 0 = Sunday … 6 = Saturday. */
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    venue: Venue | null;
    agenda: string;
}

export type ExceptionKind = 'override' | 'one-off';

export interface EventException {
    kind: ExceptionKind;
    status: 'scheduled' | 'cancelled';
    startTime: string;
    endTime: string;
    venue: Venue | null;
    agenda: string;
}

export interface Occurrence {
    date: string;
    startTime: string;
    endTime: string;
    venue: Venue | null;
    agenda: string;
    /**
     * `hall-override` means one hall's own document changed this date's times or
     * venue. See `effectiveEventFor`.
     */
    source: 'rule' | 'override' | 'one-off' | 'hall-override';
}

/** "HH:MM" to minutes, or null. Mirrors parseTimeToMinutes server-side. */
function minutesOf(hhmm: unknown): number | null {
    if (typeof hhmm !== 'string') return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;
    return hours * 60 + mins;
}

/** Add days to a `YYYY-MM-DD` key. UTC arithmetic, so no zone can shift it. */
export function addDaysToDateKey(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
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
 * Day-of-week for a date key, read at UTC noon so no DST edge shifts it.
 *
 * RETURNS -1 FOR ANYTHING THAT IS NOT A BARE DATE KEY. An event id can now be
 * `2026-08-07__somerville`, and `.split('-').map(Number)` on that yields
 * `[2026, 8, NaN]` → an Invalid Date → NaN, which `daysOfWeek.includes` reads as
 * false. On the server that makes a date look like it is LOSING ITS SABHA, and
 * `reconcileDate` then cancels its rides. -1 matches no weekday, so the answer is the
 * same — the difference is that it is false for a stated reason rather than by
 * accident.
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
    const start = minutesOf(startTime);
    const end = minutesOf(endTime);
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

export function normaliseException(raw: unknown): EventException | null {
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as Record<string, unknown>;

    const start = typeof e.startTime === 'string' ? e.startTime : '';
    const end = typeof e.endTime === 'string' ? e.endTime : '';
    const startMin = minutesOf(start);
    const endMin = minutesOf(end);
    const usableTimes = startMin !== null && endMin !== null && endMin > startMin;

    const status = e.status === 'cancelled' ? 'cancelled' : 'scheduled';
    if (status === 'scheduled' && !usableTimes) return null;

    return {
        // Absent `kind` reads as an override — the conservative direction. It then
        // only affects a date the rule already covers, rather than inventing a
        // gathering nobody scheduled.
        kind: e.kind === 'one-off' ? 'one-off' : 'override',
        status,
        startTime: usableTimes ? start : '',
        endTime: usableTimes ? end : '',
        venue: toVenue(e.venue),
        agenda: typeof e.agenda === 'string' ? e.agenda : '',
    };
}

export function coversDate(rule: RecurrenceRule | null, dateKey: string): boolean {
    if (!rule?.enabled) return false;
    return rule.daysOfWeek.includes(dayOfWeekForKey(dateKey));
}

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
 * What is actually happening on this date. Priority: cancellation, one-off,
 * override, rule, nothing. An override on a date the rule does not cover is
 * inert — that is what makes turning the rule off safe.
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
        if (!covered) return null;
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

export function upcomingOccurrences(
    rule: RecurrenceRule | null,
    exceptions: ReadonlyMap<string, EventException>,
    fromKey: string,
    toKey: string,
    limit: number,
): Occurrence[] {
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

// Pure module: this is the only import, and it is a pure string function too.
import { formatTime } from '../constants/schedule';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * How the rule reads on the manager's card.
 *
 * 12-hour, like every other time this app shows a person. It used to print the
 * stored "20:30–22:00" straight through, which put two clock formats on one card:
 * the header in 24-hour and the sabha beneath it in 12-hour.
 */
export function describeRule(rule: RecurrenceRule | null): string {
    if (!rule || !rule.enabled) return 'Not repeating';
    const days = rule.daysOfWeek.map(d => DAY_NAMES[d]).join(', ');
    return `Every ${days}, ${formatTime(rule.startTime)}–${formatTime(rule.endTime)}`;
}

/** The label a calendar row carries, so a manager can see why a date looks the way it does. */
export function labelForSource(source: Occurrence['source']): string | null {
    switch (source) {
        case 'override': return 'Edited';
        case 'one-off': return 'One-off';
        case 'hall-override': return 'One sabha changed';
        // A date straight from the rule needs no badge — it is the default, and
        // labelling every row "from the schedule" is noise.
        default: return null;
    }
}
