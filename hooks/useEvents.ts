import { useEffect, useState } from 'react';
import {
    collection, doc, onSnapshot, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase/config';

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

/** Today's date as YYYY-MM-DD. Only used to bound the query, never to pick the current event. */
const todayKey = () => new Date().toISOString().slice(0, 10);

/** Upcoming gatherings, soonest first. Includes cancelled ones so they can be restored. */
export function useUpcomingEvents(limitTo = 12) {
    const [events, setEvents] = useState<SabhaEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const q = query(
            collection(db, 'events'),
            where('date', '>=', todayKey()),
            orderBy('date'),
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
    }, [limitTo]);

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
): Promise<void> {
    await setDoc(doc(db, 'events', date), {
        date,
        startTime,
        endTime,
        venue: null,
        status: 'scheduled',
        agenda,
        autoCreated: false,
        createdBy: createdByUid,
        createdAt: new Date().toISOString(),
    }, { merge: true });
}
