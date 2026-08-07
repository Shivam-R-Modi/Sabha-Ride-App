import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { fallbackEventId } from '../src/utils/weekUtils';

/**
 * The gathering the app is currently working towards, as published by the
 * server.
 *
 * Attendance is keyed by `eventId`, and this is the only place it comes from.
 * It used to be computed in the browser by `getCurrentWeekId()`, which read the
 * *device* clock — so a student whose phone was in another timezone, or simply
 * set wrong, wrote their response into a different gathering's record than the
 * manager was reading. The count was quietly short and nobody could see why.
 *
 * `attendanceLocksAt` is an absolute instant for the same reason: the client
 * compares it against `now` rather than working out whether it is "past
 * Thursday 6 PM" itself.
 */

export interface CurrentEvent {
    eventId: string;
    startsAt?: string;
    endsAt?: string;
    dropoffOpensAt?: string;
    attendanceLocksAt?: string;
}

export function useCurrentEvent() {
    const [event, setEvent] = useState<CurrentEvent | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'system', 'rideContext'),
            (snap) => {
                const data = snap.exists() ? snap.data() : null;
                setEvent({
                    // Until the scheduler has published once, fall back to the
                    // local calculation so attendance keeps working through the
                    // deploy rather than writing to `undefined`.
                    eventId: data?.eventId || fallbackEventId(),
                    startsAt: data?.startsAt,
                    endsAt: data?.endsAt,
                    dropoffOpensAt: data?.dropoffOpensAt,
                    attendanceLocksAt: data?.attendanceLocksAt,
                });
                setLoading(false);
            },
            (error) => {
                console.error('[useCurrentEvent] Listener error:', error);
                setEvent({ eventId: fallbackEventId() });
                setLoading(false);
            }
        );
        return unsub;
    }, []);

    /**
     * Can a "yes" still be withdrawn? Past the lock, drivers are already planned
     * around the answer.
     */
    const canWithdraw = (() => {
        if (!event?.attendanceLocksAt) return true;
        return new Date() < new Date(event.attendanceLocksAt);
    })();

    return { event, eventId: event?.eventId, canWithdraw, loading };
}
