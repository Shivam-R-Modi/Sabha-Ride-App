import { useEffect, useMemo, useState } from 'react';
import {
    collection, doc, documentId, onSnapshot, orderBy, query, setDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useCurrentEvent } from './useCurrentEvent';
import {
    EventException, Occurrence, RecurrenceRule,
    addDaysToDateKey, normaliseException, normaliseRecurrence, upcomingOccurrences,
} from '../src/utils/recurrence';
import { dateKeyOfEventId } from '../src/utils/locations';

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
): Promise<void> {
    await setDoc(doc(db, 'events', date), {
        date,
        // A one-off stays a one-off. Anything derived from the rule — or already an
        // override — is an override.
        kind: source === 'one-off' ? 'one-off' : 'override',
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
