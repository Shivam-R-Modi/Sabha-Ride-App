/**
 * useGooglePlaces — React hook for Google Places Autocomplete
 *
 * Dynamically loads the Google Maps JS SDK (Places library) and exposes:
 *   • getPlacePredictions(input) — debounced address suggestions
 *   • getPlaceDetails(placeId)  — lat/lng + formatted address for a place
 *
 * Works with referer-restricted API keys (client-side JS SDK).
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ---- Types ----------------------------------------------------------------

export interface PlacePrediction {
    placeId: string;
    description: string;        // full formatted suggestion text
    mainText: string;           // primary text (e.g. "41-99 Clifford St")
    secondaryText: string;      // secondary text (e.g. "Boston, MA, USA")
}

export interface PlaceDetails {
    latitude: number;
    longitude: number;
    formattedAddress: string;
    placeId: string;
}

// ---- SDK Loader ------------------------------------------------------------

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

let loadPromise: Promise<void> | null = null;

/** Load the Google Maps JS SDK (with Places library) exactly once. */
export function loadGoogleMapsSDK(): Promise<void> {
    if ((window as any).google?.maps?.places) {
        return Promise.resolve();
    }

    if (loadPromise) return loadPromise;

    loadPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google Maps SDK'));
        document.head.appendChild(script);
    });

    return loadPromise;
}

// ---- Standalone geocode ----------------------------------------------------

/**
 * Turn a typed address into coordinates, in the BROWSER.
 *
 * WHY THIS IS NOT THE CLOUD FUNCTION
 * ----------------------------------
 * There was a `geocodeAddress` callable, and it returned 500 for every call for
 * as long as it existed:
 *
 *     REQUEST_DENIED – API keys with referer restrictions
 *                      cannot be used with this API.
 *
 * `GOOGLE_MAPS_API_KEY` in `functions/.env` is an HTTP-referer-restricted key.
 * Referer restrictions are a BROWSER mechanism — the server sends no referer, so
 * such a key can never work server-to-server. Fixing it that way needed a second,
 * unrestricted or IP-restricted key: another credential to store, rotate and leak.
 *
 * The browser key already does this, which is the whole reason the SDK loader
 * above exists. Verified against production on 2026-08-18: the same key that
 * powers autocomplete geocodes "346 Huntington Ave" to 42.339362, -71.0878001.
 * So the fix is to stop needing a server key at all.
 *
 * The trust model is unchanged. Autocomplete has always produced coordinates in
 * the browser and `ProfileEditor` has always written them, so client-supplied
 * coordinates were already accepted; this only closes the one path that was
 * broken. The referer restriction is what keeps the key usable only from the
 * app's own origin.
 *
 * Returns null rather than throwing on a miss, because every caller's next move
 * is the same: ask the person to pick a suggestion instead.
 */
export async function geocodeAddressInBrowser(address: string): Promise<PlaceDetails | null> {
    const trimmed = address.trim();
    if (trimmed.length < 3) return null;

    await loadGoogleMapsSDK();

    return new Promise<PlaceDetails | null>(resolve => {
        new google.maps.Geocoder().geocode({ address: trimmed }, (results, status) => {
            if (status !== google.maps.GeocoderStatus.OK || !results?.length) {
                // Includes ZERO_RESULTS, which is an answer rather than a fault.
                resolve(null);
                return;
            }
            const best = results[0];
            const { lat, lng } = best.geometry.location;
            resolve({
                latitude: lat(),
                longitude: lng(),
                formattedAddress: best.formatted_address || trimmed,
                placeId: best.place_id || '',
            });
        });
    });
}

// ---- Hook ------------------------------------------------------------------

export function useGooglePlaces() {
    const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
    const [loading, setLoading] = useState(false);
    const [sdkReady, setSdkReady] = useState(false);

    const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
    const placesService = useRef<google.maps.places.PlacesService | null>(null);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load SDK on mount
    useEffect(() => {
        loadGoogleMapsSDK()
            .then(() => {
                autocompleteService.current = new google.maps.places.AutocompleteService();
                // PlacesService needs a DOM element (can be hidden)
                const div = document.createElement('div');
                placesService.current = new google.maps.places.PlacesService(div);
                setSdkReady(true);
            })
            .catch((err) => console.error('Google Maps SDK load error:', err));
    }, []);

    // ---- getPlacePredictions (debounced) ------------------------------------

    const getPlacePredictions = useCallback(
        (input: string) => {
            // Clear previous timer
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }

            const trimmed = input.trim();
            if (!trimmed || trimmed.length < 3) {
                setPredictions([]);
                setLoading(false);
                return;
            }

            setLoading(true);

            debounceTimer.current = setTimeout(() => {
                if (!autocompleteService.current) {
                    setLoading(false);
                    return;
                }

                autocompleteService.current.getPlacePredictions(
                    {
                        input: trimmed,
                        types: ['address'],
                        componentRestrictions: { country: 'us' },
                    },
                    (results, status) => {
                        setLoading(false);
                        if (
                            status === google.maps.places.PlacesServiceStatus.OK &&
                            results
                        ) {
                            setPredictions(
                                results.map((r) => ({
                                    placeId: r.place_id,
                                    description: r.description,
                                    mainText: r.structured_formatting.main_text,
                                    secondaryText: r.structured_formatting.secondary_text,
                                }))
                            );
                        } else {
                            setPredictions([]);
                        }
                    }
                );
            }, 300);
        },
        []
    );

    // ---- getPlaceDetails ---------------------------------------------------

    const getPlaceDetails = useCallback(
        (placeId: string): Promise<PlaceDetails> => {
            return new Promise((resolve, reject) => {
                if (!placesService.current) {
                    reject(new Error('Places service not initialised'));
                    return;
                }

                placesService.current.getDetails(
                    { placeId, fields: ['geometry', 'formatted_address', 'place_id'] },
                    (place, status) => {
                        if (
                            status === google.maps.places.PlacesServiceStatus.OK &&
                            place?.geometry?.location
                        ) {
                            resolve({
                                latitude: place.geometry.location.lat(),
                                longitude: place.geometry.location.lng(),
                                formattedAddress: place.formatted_address || '',
                                placeId: place.place_id || placeId,
                            });
                        } else {
                            reject(new Error('Failed to get place details'));
                        }
                    }
                );
            });
        },
        []
    );

    // Cleanup debounce timer
    useEffect(() => {
        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, []);

    return {
        predictions,
        loading,
        sdkReady,
        getPlacePredictions,
        getPlaceDetails,
        clearPredictions: () => setPredictions([]),
    };
}
