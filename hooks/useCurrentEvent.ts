import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

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
 *
 * `eventId` is null when no sabha is scheduled. Callers must handle that rather
 * than substituting a guessed date — inventing one is how an empty calendar used
 * to look like a normal week.
 */

export interface CurrentEvent {
    eventId: string | null;
    /**
     * 'no-scheduled-event' means the manager has cancelled everything inside the
     * generator's horizon — a deliberate shutdown, not a fault. Without this the
     * UI could only say "No rides available", which reads like a malfunction.
     */
    calendarStatus?: 'ok' | 'no-scheduled-event';
    requestsOpenAt?: string;
    startsAt?: string;
    endsAt?: string;
    dropoffOpensAt?: string;
    closesAt?: string;
    attendanceLocksAt?: string;
    venue?: { lat: number; lng: number; address: string } | null;
    agenda?: string;
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
                    eventId: data?.eventId ?? null,
                    calendarStatus: data?.calendarStatus,
                    requestsOpenAt: data?.requestsOpenAt,
                    startsAt: data?.startsAt,
                    endsAt: data?.endsAt,
                    dropoffOpensAt: data?.dropoffOpensAt,
                    closesAt: data?.closesAt,
                    attendanceLocksAt: data?.attendanceLocksAt,
                    venue: data?.venue ?? null,
                    agenda: data?.agenda,
                });
                setLoading(false);
            },
            (error) => {
                console.error('[useCurrentEvent] Listener error:', error);
                setEvent({ eventId: null });
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

    return {
        event,
        eventId: event?.eventId ?? null,
        calendarStatus: event?.calendarStatus,
        /** False when no sabha is scheduled — attendance and requests make no sense then. */
        hasEvent: !!event?.eventId,
        canWithdraw,
        loading,
    };
}
