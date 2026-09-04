import { useEffect, useMemo, useState } from 'react';
import {
    collection, doc, documentId, onSnapshot, orderBy, query, setDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useCurrentEvent } from './useCurrentEvent';
import {
    EventException, Occurrence, RecurrenceRule,
    addDaysToDateKey, normaliseException, normaliseRecurrence, upcomingOccurrences,
    applyHallException,
} from '../src/utils/recurrence';
import { dateKeyOfEventId, parseExceptionId, exceptionIdFor } from '../src/utils/locations';

/**
 * The sabha calendar — a rule, plus the exceptions to it.
 *
 * WHAT CHANGED, AND WHY THE OLD SHAPE WAS WRONG
 * ---------------------------------------------
 * This used to read `events/{YYYY-MM-DD}` documents and present each one as a
 * gathering. That matched a server which materialised a document per occurrence
 * out to a horizon, and it meant a weekly sabha appeared as up to 26 near-identical
 * rows the manager had to trust were all the same.
 *
 * The schedule now lives in `settings/sabhaRecurrence` and repeats with no end
 * date. Documents are only DIVERGENCES: an edited week, a cancelled week, or a
 * one-off on a date the rule does not cover. So this hook reads both and computes
 * what is actually happening, using the same pure functions the server uses —
 * pinned to the same test vectors, because the two disagreeing would show a rider
 * one date while dispatch worked towards another.
 *
 * Managers write here; everyone else reads. Enforced in firestore.rules, not
 * here: a check in the client is a hint, not a control.
 */

export interface SabhaEvent {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    venue: { lat: number; lng: number; address: string } | null;
    status: 'scheduled' | 'cancelled';
    agenda: string;
    /** Where this row came from, so the calendar can label what diverges. */
    source: Occurrence['source'];

    /**
     * What each hall says ON TOP of this evening, keyed by hall id.
     *
     * Only halls with a document of their own appear. A hall with none takes the
     * evening unchanged, which is the ordinary case and needs no entry — so an empty
     * object means every hall agrees, and that is what a single-hall project always
     * has.
     *
     * `null` for a hall means NOT THIS HALL TONIGHT. It is a real answer and the
     * calendar draws it: without it a manager who cancelled one room would see the
     * evening's own times on the row and no sign the room was shut, which is the
     * write-only control this codebase keeps deleting.
     */
    hallOverrides: Record<string, Occurrence | null>;
}

/**
 * How far ahead to compute. A window, not a horizon.
 *
 * The rule itself has no end date. This bounds what the manager's screen ASKS
 * for, which is a different thing from the old `weeksAhead` — nothing is created,
 * and scrolling further would simply compute further.
 */
const CALENDAR_WINDOW_DAYS = 120;

export const RECURRENCE_DOC_PATH = 'settings/sabhaRecurrence';

/** The live rule, already validated through the same function the server uses. */
export function useRecurrenceRule() {
    const [rule, setRule] = useState<RecurrenceRule | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, RECURRENCE_DOC_PATH),
            snap => {
                setRule(normaliseRecurrence(snap.data()));
                setLoading(false);
            },
            err => {
                console.error('[useRecurrenceRule] Listener error:', err);
                // Null reads as "nothing scheduled", which the calendar surfaces.
                // Guessing a rule here would put sabha on a day nobody chose.
                setRule(null);
                setLoading(false);
            },
        );
        return unsub;
    }, []);

    return { rule, loading };
}

/**
 * Each hall's own answer for one evening, from documents already in hand.
 *
 * `useUpcomingEvents` reads every document in the date range, and a hall's exception
 * is one of them — `events/{date}__{hall}`. Resolving them here costs no extra read,
 * and it is the only way the manager's calendar can SHOW a hall that diverges. It
 * used to ignore them, which was harmless while nothing could write one.
 */
function hallOverridesFor(
    occurrence: Occurrence,
    exceptions: ReadonlyMap<string, EventException>,
): Record<string, Occurrence | null> {
    const out: Record<string, Occurrence | null> = {};
    for (const [id, exception] of exceptions) {
        // A bare id is the EVENING's exception and `effectiveEvent` has already
        // applied it — `parseExceptionId` returns a null hall for exactly that shape.
        // `parseEventId` would resolve it to the founding hall instead, and file the
        // evening's own edit as that one hall's.
        const parsed = parseExceptionId(id);
        if (!parsed?.locationId || parsed.dateKey !== occurrence.date) continue;
        const applied = applyHallException(occurrence, exception);
        // `source` set here for the same reason `effectiveEventFor` sets it: a row that
        // came out of the hall layer has to SAY so, or the only way to tell a diverged
        // hall from one on the evening's times is comparing object identity — which is
        // true by accident and stops being true the moment anything copies the object.
        out[parsed.locationId] = applied && { ...applied, source: 'hall-override' };
    }
    return out;
}

/**
 * Upcoming gatherings, soonest first, exceptions applied.
 *
 * Anchored on the server-published `eventId` rather than the device clock. That
 * detail has bitten before: a lower bound of `new Date().toISOString().slice(0,10)`
 * is a UTC date, and at 20:30 in Boston it is already tomorrow in UTC — so
 * **today's sabha vanished from the manager's calendar during the sabha itself.**
 *
 * The exception query is bounded by `documentId()`, matching the server, because
 * an earlier version filtered on the `date` FIELD while the server filtered on the
 * id — so a document missing `date` was invisible here and visible to the server.
 *
 * THE ANCHOR IS THE EVENT ID'S DATE, NOT THE EVENT ID. A second hall's gathering is
 * `2026-08-07__somerville`, and `'2026-08-07' >= '2026-08-07__somerville'` is false —
 * so anchoring on the id itself brings back the same defect the paragraph above
 * describes, by a different route: today's founding-hall gathering disappears from the
 * manager's calendar for the duration of the sabha, and the row a manager would reach
 * for to cancel it is the row that is missing.
 */
export function useUpcomingEvents(limitTo = 12) {
    const [exceptions, setExceptions] = useState<Map<string, EventException>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { eventId } = useCurrentEvent();
    const { rule, loading: ruleLoading } = useRecurrenceRule();

    const from = dateKeyOfEventId(eventId) ?? new Date().toLocaleDateString('en-CA');

    useEffect(() => {
        const q = query(
            collection(db, 'events'),
            where(documentId(), '>=', from),
            orderBy(documentId()),
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const next = new Map<string, EventException>();
            for (const d of snapshot.docs) {
                const exception = normaliseException(d.data());
                if (exception) next.set(d.id, exception);
            }
            setExceptions(next);
            setLoading(false);
        }, (err) => {
            console.error('[useUpcomingEvents] Listener error:', err);
            setError('Could not load the sabha calendar.');
            setLoading(false);
        });

        return unsub;
    }, [from]);

    const events = useMemo<SabhaEvent[]>(() => {
        const to = addDaysToDateKey(from, CALENDAR_WINDOW_DAYS);
        return upcomingOccurrences(rule, exceptions, from, to, limitTo).map(o => ({
            id: o.date,
            date: o.date,
            startTime: o.startTime,
            endTime: o.endTime,
            venue: o.venue,
            // upcomingOccurrences has already dropped cancellations. A row that
            // reaches here is happening.
            status: 'scheduled' as const,
            agenda: o.agenda,
            source: o.source,
            hallOverrides: hallOverridesFor(o, exceptions),
        }));
    }, [rule, exceptions, from, limitTo]);

    return { events, loading: loading || ruleLoading, error, rule };
}

/**
 * Change ONE date: its times, venue or agenda.
 *
 * Writes an exception for that date. Settled with the owner on 2026-08-17:
 * editing one Friday affects only that Friday, and the rule and every other week
 * stay exactly as they were. So this stores a FULL snapshot — the edited date
 * keeps these values and will not follow a later change to the rule.
 *
 * `source` IS NOT OPTIONAL, AND HERE IS WHY
 * -----------------------------------------
 * This function used to hardcode `kind: 'override'`, and it cost a live sabha.
 *
 * An override on a date the rule does not cover is deliberately INERT — that is
 * the mechanism that lets a manager switch the weekly rule off without stray
 * gatherings reappearing. So editing a ONE-OFF (a Monday, say, against a Friday
 * rule) converted it to an override and made it vanish.
 *
 * Observed in production on 2026-08-17: a manager changed the end time of that
 * evening's Monday gathering, and the app rolled forward to the following Friday
 * with two riders already marked `at_sabha` against a gathering that was no
 * longer current. Four minutes, and nothing on any screen said so.
 *
 * Editing a row must preserve WHAT KIND OF ROW IT WAS. The caller already knows —
 * `SabhaEvent.source` — so it is required rather than defaulted, because a
 * default here is what silently deleted a gathering.
 */
export async function editOccurrence(
    date: string,
    values: Pick<SabhaEvent, 'startTime' | 'endTime' | 'agenda' | 'venue'>,
    updatedByUid: string,
    source: SabhaEvent['source'],
    /**
     * ONE HALL, or null for the whole evening.
     *
     * A hall's document is always an OVERRIDE, never a one-off: both halls run the
     * same evening, so a hall says "at a different time" and never "on a day the
     * congregation is not meeting". `effectiveEventFor` relies on that — a one-off
     * hall document would be inert there, so writing one would look saved and change
     * nothing.
     */
    locationId: string | null = null,
): Promise<void> {
    // `exceptionIdFor`, not `eventIdFor`: for the FOUNDING hall the latter returns the
    // bare date, which is the WHOLE EVENING'S document — so editing that one hall would
    // move every hall's start time. See `exceptionIdFor`.
    const eventId = exceptionIdFor(date, locationId);
    if (!eventId) throw new Error('That sabha location is not valid.');

    await setDoc(doc(db, 'events', eventId), {
        date,
        // Stamped so `events` is readable without parsing document ids.
        ...(locationId ? { locationId } : {}),
        // A one-off stays a one-off. Anything derived from the rule — or already an
        // override — is an override. A HALL is always an override; see above.
        kind: !locationId && source === 'one-off' ? 'one-off' : 'override',
        status: 'scheduled',
        startTime: values.startTime,
        endTime: values.endTime,
        agenda: values.agenda,
        // null means "use the rule's venue, or the default from settings/main".
        // Only ever set with coordinates — an address without them poisons routing.
        venue: values.venue,
        updatedBy: updatedByUid,
        updatedAt: new Date().toISOString(),
    }, { merge: true });
}

/**
 * Add a gathering on a date the rule does not cover.
 *
 * `kind: 'one-off'` is what makes it stand on its own: an override would be inert
 * off-pattern, which is correct for an edited week and wrong for a deliberate
 * extra date.
 *
 * The date is the document id, so adding the same date twice edits it rather than
 * creating a duplicate — the behaviour you want, since two gatherings on one day
 * is not something this model supports.
 */
export async function createOneOff(
    date: string,
    startTime: string,
    endTime: string,
    agenda: string,
    createdByUid: string,
    venue: SabhaEvent['venue'] = null,
): Promise<void> {
    await setDoc(doc(db, 'events', date), {
        date,
        kind: 'one-off',
        status: 'scheduled',
        startTime,
        endTime,
        venue,
        agenda,
        createdBy: createdByUid,
        createdAt: new Date().toISOString(),
    }, { merge: true });
}

// `updateEvent` and `createEvent` were here. Both wrote documents that WERE the
// gathering; under the rule model a document is an exception, and the two cases
// are no longer the same write. `editOccurrence` changes one date;
// `createOneOff` adds a date the rule does not cover. Cancelling a week is
// `deleteSabhaEvent`, which writes a cancellation exception server-side so the
// attendance and ride cascade runs with it.
