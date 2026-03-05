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

export interface AppSettings {
    sabhaLocation: SabhaLocation;
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
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'settings', 'main'),
            (snap) => {
                if (snap.exists()) {
                    const data = snap.data() as AppSettings;
                    setSettings({
                        sabhaLocation: data.sabhaLocation ?? DEFAULT_SABHA_LOCATION,
                        lastUpdated: data.lastUpdated,
                        updatedBy: data.updatedBy,
                    });
                } else {
                    // Document doesn't exist yet — use default
                    setSettings({ sabhaLocation: DEFAULT_SABHA_LOCATION });
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

    return {
        sabhaLocation: settings.sabhaLocation,
        settings,
        loading,
        error,
        updateSabhaLocation,
    };
}
