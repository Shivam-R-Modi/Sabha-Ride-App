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
 * When sabha starts and ends, as "HH:MM" in Sabha local time.
 *
 * These drive everything: pickups are open from Wednesday until the start time,
 * and drop-off opens 15 minutes before the end time. They used to be literals
 * inside a Cloud Function, so moving sabha needed a code change and a deploy.
 *
 * PickupForm also read `settings.timeSlot` and then `settings.arrivalTimeSlot`,
 * neither of which useSettings returned, so the arrival time riders were shown
 * always fell through to a hardcoded '5:30 PM'.
 */
export const DEFAULT_SABHA_START = '19:00';
export const DEFAULT_SABHA_END = '22:00';

export interface AppSettings {
    sabhaLocation: SabhaLocation;
    sabhaStartTime: string;
    sabhaEndTime: string;
    lastUpdated?: string;
    updatedBy?: string;
}

/** "19:00" → "7:00 PM". Mirrors formatTimeForDisplay in functions/src/utils/schedule.ts. */
export function formatTime(value: string): string {
    const match = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
    if (!match) return value;

    const hours24 = Number(match[1]);
    const minutes = match[2];
    if (hours24 < 0 || hours24 > 23) return value;

    const suffix = hours24 < 12 ? 'AM' : 'PM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

    return `${hours12}:${minutes} ${suffix}`;
}

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
     * Update when sabha starts and ends. Manager-only, enforced by rules.
     * Values are "HH:MM" in Sabha local time; the scheduler derives the pickup
     * and drop-off windows from them.
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

    return {
        sabhaLocation: settings.sabhaLocation,
        sabhaStartTime: settings.sabhaStartTime,
        sabhaEndTime: settings.sabhaEndTime,
        settings,
        loading,
        error,
        updateSabhaLocation,
        updateSabhaTimes,
    };
}
