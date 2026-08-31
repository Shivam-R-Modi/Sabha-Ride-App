import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_SABHA_START, DEFAULT_SABHA_END, formatTime } from '../src/constants/schedule';

/**
 * Default Sabha location used as fallback when Firestore has no settings doc.
 */
export const DEFAULT_SABHA_LOCATION = {
    lat: 42.339925,
    lng: -71.088182,
    address: '360 Huntington Ave, Boston, MA 02115',
};

export interface SabhaLocation {
    lat: number;
    lng: number;
    address: string;
}

/**
 * The DEFAULT sabha start and end, as "HH:MM" in Sabha local time.
 *
 * Defaults, not the schedule — see src/constants/schedule.ts, which owns them now
 * so that non-React code and the tests can read them without pulling in Firebase.
 * Re-exported here because this is where callers have always imported them from.
 *
 * They used to be literals inside a Cloud Function, so moving sabha needed a code
 * change and a deploy. PickupForm also read `settings.timeSlot` and then
 * `settings.arrivalTimeSlot`, neither of which useSettings returned, so the
 * arrival time riders were shown always fell through to a hardcoded '5:30 PM'.
 */
export { DEFAULT_SABHA_START, DEFAULT_SABHA_END };

export interface AppSettings {
    sabhaLocation: SabhaLocation;
    sabhaStartTime: string;
    sabhaEndTime: string;
    /** "HH:MM" local, on the lead day. Absent means the shipped 10:00. */
    requestsOpenTime?: string;
    lastUpdated?: string;
    updatedBy?: string;
}

/**
 * Re-exported, not defined here.
 *
 * It is a pure string function, and living in this module — which imports
 * firebase/config — put it out of reach of every pure module that needs to print
 * a time. `describeRule` could not use it, so the manager's calendar header said
 * "20:30-22:00" directly above a card saying "8:30 PM - 10:00 PM".
 */
export { formatTime } from '../src/constants/schedule';

/**
 * Real-time hook that subscribes to `settings/main` in Firestore.
 * Returns the current Sabha location (or the default fallback) and
 * a function to update it (manager-only).
 */
export function useSettings() {
    const [settings, setSettings] = useState<AppSettings>({
        sabhaLocation: DEFAULT_SABHA_LOCATION,
        sabhaStartTime: DEFAULT_SABHA_START,
        sabhaEndTime: DEFAULT_SABHA_END,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'settings', 'main'),
            (snap) => {
                if (snap.exists()) {
                    const data = snap.data() as Partial<AppSettings>;
                    setSettings({
                        sabhaLocation: data.sabhaLocation ?? DEFAULT_SABHA_LOCATION,
                        sabhaStartTime: data.sabhaStartTime || DEFAULT_SABHA_START,
                        sabhaEndTime: data.sabhaEndTime || DEFAULT_SABHA_END,
                        lastUpdated: data.lastUpdated,
                        updatedBy: data.updatedBy,
                    });
                } else {
                    // Document doesn't exist yet — use defaults
                    setSettings({
                        sabhaLocation: DEFAULT_SABHA_LOCATION,
                        sabhaStartTime: DEFAULT_SABHA_START,
                        sabhaEndTime: DEFAULT_SABHA_END,
                    });
                }
                setLoading(false);
            },
            (err) => {
                console.error('[useSettings] Firestore listener error:', err);
                setError(err.message);
                setLoading(false);
            }
        );
        return unsub;
    }, []);

    /**
     * Update the Sabha location in Firestore.
     * Only callable by managers (enforced by Firestore rules).
     */
    const updateSabhaLocation = async (
        location: SabhaLocation,
        updatedByUid: string
    ) => {
        const ref = doc(db, 'settings', 'main');
        await setDoc(
            ref,
            {
                sabhaLocation: {
                    lat: location.lat,
                    lng: location.lng,
                    address: location.address,
                },
                lastUpdated: new Date().toISOString(),
                updatedBy: updatedByUid,
            },
            { merge: true }
        );
    };

    /**
     * Update the DEFAULT sabha start and end. Manager-only, enforced by rules.
     *
     * Values are "HH:MM" in Sabha local time. This does NOT move a sabha that is
     * already on the calendar — each event owns its own times, and the published
     * ride window is built from those (buildCurrentEvent). What these do is
     * prefill the Calendar's "Add a sabha" form (newSabhaTimes in
     * components/manager/SabhaCalendar.tsx) and seed the very first gathering on a
     * fresh project (seedFirstEventIfNeeded).
     *
     * The previous comment here claimed "the scheduler derives the pickup and
     * drop-off windows from them", which stopped being true when events got their
     * own dates and times — and for a while nothing read these fields at all, so
     * the Settings control reported success and changed nothing anywhere.
     * To move tonight's sabha, edit it in the Sabha Calendar.
     */
    const updateSabhaTimes = async (
        sabhaStartTime: string,
        sabhaEndTime: string,
        updatedByUid: string
    ) => {
        await setDoc(
            doc(db, 'settings', 'main'),
            {
                sabhaStartTime,
                sabhaEndTime,
                lastUpdated: new Date().toISOString(),
                updatedBy: updatedByUid,
            },
            { merge: true }
        );
    };

    /**
     * The time of day, on the lead day, that ride requests open.
     *
     * WAS AN UNCHOSEN MIDNIGHT. "Two days before" was expressed as a date with no
     * time, so the boundary landed at 00:00 by default. Harmless while the only
     * consequence was a button becoming tappable, and not harmless once the window
     * started announcing itself — the congregation was woken to be told they could
     * book a lift in two days.
     *
     * The server validates and falls back to 10:00 on anything unparseable, so a bad
     * value here cannot stop the window opening. See buildCurrentEvent.
     */
    const updateRequestsOpenTime = async (requestsOpenTime: string, updatedByUid: string) => {
        await setDoc(
            doc(db, 'settings', 'main'),
            { requestsOpenTime, lastUpdated: new Date().toISOString(), updatedBy: updatedByUid },
            { merge: true },
        );
    };

    return {
        sabhaLocation: settings.sabhaLocation,
        sabhaStartTime: settings.sabhaStartTime,
        sabhaEndTime: settings.sabhaEndTime,
        requestsOpenTime: settings.requestsOpenTime,
        updateRequestsOpenTime,
        settings,
        loading,
        error,
        updateSabhaLocation,
        updateSabhaTimes,
    };
}
