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
function loadGoogleMapsSDK(): Promise<void> {
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
