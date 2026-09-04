import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { windowForLocation } from '../src/utils/locations';

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
     * Which direction is open, straight from the server.
     *
     * Exposed so the manager's queue can be filtered exactly as dispatch filters
     * it. Without it the two disagreed: dispatch refuses a leftover pickup during
     * the drop-off window, while the Waiting tab went on counting it — so a
     * manager saw riders queued that no tap could ever serve.
     */
    rideType?: 'home-to-sabha' | 'sabha-to-home' | null;
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

/**
 * `locationId` picks which hall's window to read.
 *
 * OMITTED MEANS THE AGGREGATE, which is the founding hall — the right answer for
 * anybody who has not chosen a hall yet, and for every caller that predates halls. All
 * of them pass nothing and are unchanged.
 */
export function useCurrentEvent(locationId: string | null = null) {
    const [event, setEvent] = useState<CurrentEvent | null>(null);
    const [fault, setFault] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'system', 'rideContext'),
            (snap) => {
                const published = snap.exists() ? snap.data() : null;
                const { slice, fault: missing } = windowForLocation(published, locationId);
                setFault(missing);
                // Untyped Firestore data, exactly as `snap.data()` was before — every
                // field below is read with a `??` fallback rather than trusted.
                const data = slice as Record<string, any> | null;
                setEvent({
                    eventId: data?.eventId ?? null,
                    rideType: data?.rideType ?? null,
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
    }, [locationId]);

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
        rideType: event?.rideType ?? null,
        calendarStatus: event?.calendarStatus,
        /**
         * This gathering's own venue, which the drop-off presence check measures
         * against. A manager can move a single sabha, so measuring that evening
         * against the standing default would put every rider kilometres out.
         */
        venue: event?.venue ?? null,
        /** False when no sabha is scheduled — attendance and requests make no sense then. */
        hasEvent: !!event?.eventId,
        canWithdraw,
        /**
         * The server published a hall list that does not include this hall.
         *
         * A SERVER FAULT, and a caller must render it as one rather than as "no sabha
         * tonight". Distinguishing the two is the whole reason `calendarStatus` exists.
         */
        locationFault: fault,
        loading,
    };
}
