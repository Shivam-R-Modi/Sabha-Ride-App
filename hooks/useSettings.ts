import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

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
 * Standard arrival time shown on the ride request screen.
 *
 * PickupForm read `settings.timeSlot`, then `settings.arrivalTimeSlot`, and
 * useSettings returned neither — it only ever returned sabhaLocation. So the
 * expression always fell through to the literal below and no manager could
 * change the time a rider is told to arrive. It is a real setting now.
 */
export const DEFAULT_ARRIVAL_TIME = '5:30 PM';

export interface AppSettings {
    sabhaLocation: SabhaLocation;
    arrivalTime: string;
    lastUpdated?: string;
    updatedBy?: string;
}

/**
 * Real-time hook that subscribes to `settings/main` in Firestore.
 * Returns the current Sabha location (or the default fallback) and
 * a function to update it (manager-only).
 */
export function useSettings() {
    const [settings, setSettings] = useState<AppSettings>({
        sabhaLocation: DEFAULT_SABHA_LOCATION,
        arrivalTime: DEFAULT_ARRIVAL_TIME,
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
                        arrivalTime: data.arrivalTime || DEFAULT_ARRIVAL_TIME,
                        lastUpdated: data.lastUpdated,
                        updatedBy: data.updatedBy,
                    });
                } else {
                    // Document doesn't exist yet — use defaults
                    setSettings({
                        sabhaLocation: DEFAULT_SABHA_LOCATION,
                        arrivalTime: DEFAULT_ARRIVAL_TIME,
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

    /** Update the standard arrival time. Manager-only, enforced by rules. */
    const updateArrivalTime = async (arrivalTime: string, updatedByUid: string) => {
        await setDoc(
            doc(db, 'settings', 'main'),
            {
                arrivalTime,
                lastUpdated: new Date().toISOString(),
                updatedBy: updatedByUid,
            },
            { merge: true }
        );
    };

    return {
        sabhaLocation: settings.sabhaLocation,
        arrivalTime: settings.arrivalTime,
        settings,
        loading,
        error,
        updateSabhaLocation,
        updateArrivalTime,
    };
}
