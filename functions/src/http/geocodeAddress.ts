// ============================================
// HTTP FUNCTION: geocodeAddress
// Backend proxy for Google Maps Geocoding API
// ============================================

import * as functions from 'firebase-functions';
import { checkRateLimit } from '../utils/rateLimiter';

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

    // Rate limiting: 30 geocoding requests per minute
    await checkRateLimit(context.auth.uid, {
        maxRequests: 30,
        windowMs: 60 * 1000, // 1 minute
        functionName: 'geocodeAddress'
    });

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

        // Validate results array exists and has entries
        if (!result.results || !Array.isArray(result.results) || result.results.length === 0) {
            throw new functions.https.HttpsError(
                'not-found',
                'No geocoding results returned. Please verify the address and try again.'
            );
        }

        const firstResult = result.results[0];

        // Validate geometry structure
        if (!firstResult.geometry || !firstResult.geometry.location) {
            console.error('Invalid geocoding result structure:', firstResult);
            throw new functions.https.HttpsError(
                'internal',
                'Received invalid geocoding data. Please try again.'
            );
        }

        const { lat, lng } = firstResult.geometry.location;

        // Validate coordinates are valid numbers
        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
            console.error('Invalid coordinates returned:', { lat, lng });
            throw new functions.https.HttpsError(
                'internal',
                'Received invalid coordinates. Please try a different address.'
            );
        }

        // Validate coordinates are within valid range
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            console.error('Coordinates out of valid range:', { lat, lng });
            throw new functions.https.HttpsError(
                'internal',
                'Coordinates are outside valid range. Please verify the address.'
            );
        }

        // Check result quality - warn if partial match
        const isPartialMatch = firstResult.partial_match === true;
        if (isPartialMatch) {
            console.warn('Geocoding returned partial match for address:', trimmed);
        }

        return {
            latitude: lat,
            longitude: lng,
            formattedAddress: firstResult.formatted_address || trimmed,
            placeId: firstResult.place_id || null,
            partialMatch: isPartialMatch,
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        console.error('Unexpected geocoding error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to geocode address');
    }
});
