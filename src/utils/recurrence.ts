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
    source: 'rule' | 'override' | 'one-off';
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

/** Day-of-week for a date key, read at UTC noon so no DST edge shifts it. */
export function dayOfWeekForKey(dateKey: string): number {
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

export function upcomingOccurrences(
    rule: RecurrenceRule | null,
    exceptions: ReadonlyMap<string, EventException>,
    fromKey: string,
    toKey: string,
    limit: number,
): Occurrence[] {
    const candidates = new Set(occurrencesBetween(rule, fromKey, toKey));
    for (const [date, exception] of exceptions) {
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
        // A date straight from the rule needs no badge — it is the default, and
        // labelling every row "from the schedule" is noise.
        default: return null;
    }
}
