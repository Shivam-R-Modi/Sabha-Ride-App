/**
 * Google Places, answered from a canned list.
 *
 * The real hook needs a Maps key and a network, so in the harness the address
 * suggestion list simply never appeared — and that list is where a clipping bug was
 * reported on 2026-08-25 and fixed by portalling it out of its card. A screen state
 * that cannot be looked at is how visual defects ship here; the same gap has been
 * closed three times this week (`?theme=dark` on three pages, `?role=driver`, `?zone=`).
 *
 * Type three characters into any address field to see it.
 */
import { useCallback, useState } from 'react';
import type { PlacePrediction, PlaceDetails } from '../hooks/useGooglePlaces';

const CANNED: PlacePrediction[] = [
    { placeId: 'p1', description: '356 Western Avenue, Brookline, MA, USA', mainText: '356 Western Avenue', secondaryText: 'Brookline, MA, USA' },
    { placeId: 'p2', description: '356 Boylston Street, Boston, MA, USA', mainText: '356 Boylston Street', secondaryText: 'Boston, MA, USA' },
    { placeId: 'p3', description: '35 Harvard Street, Cambridge, MA, USA', mainText: '35 Harvard Street', secondaryText: 'Cambridge, MA, USA' },
    { placeId: 'p4', description: '3560 Washington St, Jamaica Plain, MA, USA', mainText: '3560 Washington St', secondaryText: 'Jamaica Plain, MA, USA' },
];

export function useGooglePlaces() {
    const [predictions, setPredictions] = useState<PlacePrediction[]>([]);

    return {
        predictions,
        loading: false,
        error: null as string | null,
        getPlacePredictions: useCallback((q: string) => {
            setPredictions(q.trim().length >= 3 ? CANNED : []);
        }, []),
        getPlaceDetails: useCallback(async (placeId: string): Promise<PlaceDetails> => {
            const hit = CANNED.find(c => c.placeId === placeId) ?? CANNED[0];
            // `latitude`/`longitude`, not lat/lng — the real shape. A stub that guessed
            // would make the harness accept a payload the app would reject.
            return {
                latitude: 42.34,
                longitude: -71.12,
                formattedAddress: hit.description,
                placeId: hit.placeId,
            };
        }, []),
        clearPredictions: useCallback(() => setPredictions([]), []),
    };
}

export const geocodeAddressInBrowser = async () => null;
