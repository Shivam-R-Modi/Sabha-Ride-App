import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Which rides are open right now — one answer, shared by every screen.
 *
 * Before this, three places decided independently:
 *
 *  - `StudentDashboard` computed `now.getDay() === 5 && now.getHours() >= 22`
 *    off the DEVICE clock, on a 60-second interval. A phone in another timezone
 *    got the wrong answer, and a manager moving sabha changed nothing at all.
 *  - `studentReadyToLeave` (the server) had the same Friday/22:00 test hardcoded,
 *    so it rejected requests the UI had just invited.
 *  - `DriverDashboard` kept its own snapshot of the same document.
 *
 * `rideType` is the value to gate on, not a re-derivation from the published
 * instants, for three reasons: it is exactly what the server-side gate checks, so
 * a button can never be enabled while the callable refuses; it reflects a
 * manager's manual override, which recomputing from timestamps would ignore; and
 * it needs no timer, because the Firestore listener pushes each transition.
 */

export interface RideWindow {
    rideType: 'home-to-sabha' | 'sabha-to-home' | null;
    /** Riders may request a ride to sabha. */
    pickupOpen: boolean;
    /** Riders may say they are ready to leave. */
    dropoffOpen: boolean;
    /** Short label, e.g. "Home → Sabha". Written by the server. */
    displayText: string;
    /** The reason, e.g. "Sabha starts at 7:00 PM" or why it is closed. */
    timeContext: string;
    /** 'no-scheduled-event' means a manager cancelled everything — not a fault. */
    calendarStatus: 'ok' | 'no-scheduled-event' | null;
    loading: boolean;
}

export function useRideWindow(): RideWindow {
    const [state, setState] = useState<Omit<RideWindow, 'loading'>>({
        rideType: null,
        pickupOpen: false,
        dropoffOpen: false,
        displayText: '',
        timeContext: '',
        calendarStatus: null,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'system', 'rideContext'),
            (snap) => {
                const data = snap.exists() ? snap.data() : null;
                const rideType = (data?.rideType ?? null) as RideWindow['rideType'];

                setState({
                    rideType,
                    pickupOpen: rideType === 'home-to-sabha',
                    dropoffOpen: rideType === 'sabha-to-home',
                    displayText: data?.displayText ?? '',
                    timeContext: data?.timeContext ?? '',
                    calendarStatus: data?.calendarStatus ?? null,
                });
                setLoading(false);
            },
            (error) => {
                // Fail closed. Showing a ride button that the server will refuse is
                // worse than showing none.
                console.error('[useRideWindow] Listener error:', error);
                setLoading(false);
            }
        );
        return unsub;
    }, []);

    return { ...state, loading };
}
