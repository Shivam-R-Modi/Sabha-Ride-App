// ============================================
// HTTP FUNCTION: geocodeAddress
// Backend proxy for Google Maps Geocoding API
// ============================================

import * as functions from 'firebase-functions';

const GEOCODING_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/**
 * HTTP Callable: Geocode an address → lat/lng
 *
 * Proxies the Google Maps Geocoding API server-side so the API key
 * doesn't need to be exposed in the frontend bundle and referer
 * restrictions don't block the request.
 *
 * Input:  { address: string }
 * Output: { latitude, longitude, formattedAddress, placeId }
 */
export const geocodeAddress = functions.https.onCall(async (data, context) => {
    // Require authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { address } = data;

    if (!address || typeof address !== 'string' || !address.trim()) {
        throw new functions.https.HttpsError('invalid-argument', 'A non-empty address string is required');
    }

    // Read the API key from environment variable (.env file)
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        console.error('GOOGLE_MAPS_API_KEY is not set in functions/.env');
        throw new functions.https.HttpsError('internal', 'Geocoding service is not configured');
    }

    const trimmed = address.trim();
    const url = `${GEOCODING_API_URL}?address=${encodeURIComponent(trimmed)}&key=${apiKey}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new functions.https.HttpsError('internal', `Geocoding request failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.status === 'ZERO_RESULTS') {
            throw new functions.https.HttpsError(
                'not-found',
                'Unable to find this address. Please check spelling and try again.'
            );
        }

        if (result.status !== 'OK') {
            console.error('Geocoding API error:', result.status, result.error_message);
            throw new functions.https.HttpsError(
                'internal',
                `Geocoding error: ${result.status} – ${result.error_message || 'Unknown error'}`
            );
        }

        const firstResult = result.results[0];
        const { lat, lng } = firstResult.geometry.location;

        return {
            latitude: lat,
            longitude: lng,
            formattedAddress: firstResult.formatted_address,
            placeId: firstResult.place_id || null,
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        console.error('Unexpected geocoding error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to geocode address');
    }
});
