import { useEffect, useState } from 'react';
import {
    collection, doc, documentId, onSnapshot, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useCurrentEvent } from './useCurrentEvent';

/**
 * The sabha calendar.
 *
 * Documents are `events/{YYYY-MM-DD}`, keyed by their own date — the same key
 * attendance has always used, so the two line up without a migration.
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
    autoCreated?: boolean;
}

/**
 * Upcoming gatherings, soonest first. Includes cancelled ones so they can be
 * restored.
 *
 * Bounded by `documentId()`, matching `findCurrentEvent` on the server, and
 * anchored on the server-published `eventId` rather than the device clock. Both
 * details matter:
 *
 *  - The previous version filtered on the `date` FIELD while the server filtered
 *    on the document id, so any event missing a `date` field was invisible here
 *    and visible to the server.
 *  - Its lower bound was `new Date().toISOString().slice(0, 10)` — a UTC date. At
 *    20:30 in Boston it is already tomorrow in UTC, so **today's sabha vanished
 *    from the manager's calendar during the sabha itself.**
 */
export function useUpcomingEvents(limitTo = 12) {
    const [events, setEvents] = useState<SabhaEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { eventId } = useCurrentEvent();

    useEffect(() => {
        // Anchor on the current gathering. Until the server has published one,
        // fall back to the local date — only as a lower bound for a list, never
        // to decide which gathering is current.
        const from = eventId ?? new Date().toLocaleDateString('en-CA');

        const q = query(
            collection(db, 'events'),
            where(documentId(), '>=', from),
            orderBy(documentId()),
        );

        const unsub = onSnapshot(q, (snapshot) => {
            setEvents(snapshot.docs.slice(0, limitTo).map((d) => {
                const data = d.data();
                return {
                    id: d.id,
                    date: data.date || d.id,
                    startTime: data.startTime || '19:00',
                    endTime: data.endTime || '22:00',
                    venue: data.venue ?? null,
                    status: data.status === 'cancelled' ? 'cancelled' : 'scheduled',
                    agenda: data.agenda || '',
                    autoCreated: data.autoCreated === true,
                };
            }));
            setLoading(false);
        }, (err) => {
            console.error('[useUpcomingEvents] Listener error:', err);
            setError('Could not load the sabha calendar.');
            setLoading(false);
        });

        return unsub;
    }, [limitTo, eventId]);

    return { events, loading, error };
}

/** Change a gathering's times, venue or agenda. */
export async function updateEvent(
    eventId: string,
    changes: Partial<Pick<SabhaEvent, 'startTime' | 'endTime' | 'agenda' | 'venue'>>,
    updatedByUid: string,
): Promise<void> {
    await updateDoc(doc(db, 'events', eventId), {
        ...changes,
        // Clears the auto-created marker: once a manager has touched it, the
        // weekly template must never treat it as disposable.
        autoCreated: false,
        updatedBy: updatedByUid,
        updatedAt: new Date().toISOString(),
    });
}

/** Cancel a gathering, or put a cancelled one back. */
export async function setEventStatus(
    eventId: string,
    status: 'scheduled' | 'cancelled',
    updatedByUid: string,
): Promise<void> {
    await updateDoc(doc(db, 'events', eventId), {
        status,
        autoCreated: false,
        updatedBy: updatedByUid,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * Add a one-off gathering on a date the weekly template would not generate.
 *
 * The date is the document id, so adding the same date twice edits it rather
 * than creating a duplicate — which is the behaviour you want, since two
 * gatherings on one day is not something this model supports.
 */
export async function createEvent(
    date: string,
    startTime: string,
    endTime: string,
    agenda: string,
    createdByUid: string,
    venue: SabhaEvent['venue'] = null,
): Promise<void> {
    await setDoc(doc(db, 'events', date), {
        date,
        startTime,
        endTime,
        // null means "use the default venue from settings/main". Only ever set
        // with coordinates — an address without them would poison routing.
        venue,
        status: 'scheduled',
        agenda,
        autoCreated: false,
        createdBy: createdByUid,
        createdAt: new Date().toISOString(),
    }, { merge: true });
}
