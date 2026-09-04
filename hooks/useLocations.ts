import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
    activeLocations as onlyActive,
    normaliseLocation,
    type SabhaLocationRecord,
} from '../src/utils/locations';

/**
 * The halls sabha runs at.
 *
 * `settings/main.sabhaLocation` held exactly one venue, which is why a second hall
 * needed a collection. This is the client's read of it.
 *
 * EVERY DOCUMENT GOES THROUGH `normaliseLocation`, which rejects rather than repairs —
 * a hall with no usable coordinates is dropped instead of being handed on with a
 * missing `lat`. That matters more than it sounds: a venue at `0,0` is the farthest
 * point on earth from every rider, and `chooseSeed` anchors each carload on the
 * farthest rider, so one malformed hall would seed every car in the congregation.
 *
 * AN EMPTY ACTIVE LIST IS A FAULT, NOT "NO SABHA". A congregation always has somewhere
 * to meet, so no active hall means the seed never ran or every document is malformed.
 * `error` is set in that case so a caller can say so rather than rendering a quiet
 * evening — the same distinction `calendarStatus: 'no-scheduled-event'` exists to draw.
 */
export function useLocations(): {
    /** Every hall, including retired ones. For a manager listing them. */
    locations: SabhaLocationRecord[];
    /** Only the halls open for business, in display order. */
    active: SabhaLocationRecord[];
    loading: boolean;
    error: string | null;
    updateLocationVenue: (
        locationId: string,
        venue: { lat: number; lng: number; address: string },
        updatedByUid: string,
    ) => Promise<void>;
} {
    const [locations, setLocations] = useState<SabhaLocationRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onSnapshot(
            collection(db, 'locations'),
            (snap) => {
                const records = snap.docs
                    .map(d => normaliseLocation(d.id, d.data()))
                    .filter((r): r is SabhaLocationRecord => r !== null);
                setLocations(records);
                setError(
                    onlyActive(records).length === 0
                        ? 'No sabha location is set up. Please contact whoever administers the app.'
                        : null,
                );
                setLoading(false);
            },
            (err) => {
                console.error('[useLocations] Firestore listener error:', err);
                setError(err.message);
                setLoading(false);
            },
        );
        return unsub;
    }, []);

    /**
     * Move one hall.
     *
     * `active` IS DELIBERATELY NOT WRITABLE HERE, matching firestore.rules: turning a
     * hall on means riders can book it and Sarthis can be sent to it, and turning one
     * off abandons whatever is already booked there. Both go through a callable with a
     * stranded-riders preview when that arrives.
     */
    const updateLocationVenue = async (
        locationId: string,
        venue: { lat: number; lng: number; address: string },
        updatedByUid: string,
    ) => {
        await setDoc(
            doc(db, 'locations', locationId),
            { venue, lastUpdated: new Date().toISOString(), updatedBy: updatedByUid },
            { merge: true },
        );
    };

    return { locations, active: onlyActive(locations), loading, error, updateLocationVenue };
}
