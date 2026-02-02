/**
 * Location Utilities for Sabha Ride Seva
 * Includes Haversine formula for distance calculation and coordinate utilities
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Distance in kilometers
 */
export function haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Get current position using browser geolocation API
 * @returns Promise with lat/lng coordinates
 */
export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by this browser'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                });
            },
            (error) => {
                let errorMessage = 'Unable to retrieve location';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = 'Location permission denied';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = 'Location information unavailable';
                        break;
                    case error.TIMEOUT:
                        errorMessage = 'Location request timed out';
                        break;
                }
                reject(new Error(errorMessage));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            }
        );
    });
}

/**
 * Watch position changes
 * @param callback Function to call when position updates
 * @returns Watch ID for clearing
 */
export function watchPosition(
    callback: (position: { lat: number; lng: number }) => void,
    errorCallback?: (error: Error) => void
): number | null {
    if (!navigator.geolocation) {
        errorCallback?.(new Error('Geolocation is not supported'));
        return null;
    }

    return navigator.geolocation.watchPosition(
        (position) => {
            callback({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
            });
        },
        (error) => {
            let errorMessage = 'Location error';
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = 'Permission denied';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = 'Position unavailable';
                    break;
                case error.TIMEOUT:
                    errorMessage = 'Timeout';
                    break;
            }
            errorCallback?.(new Error(errorMessage));
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
        }
    );
}

/**
 * Clear position watch
 * @param watchId Watch ID from watchPosition
 */
export function clearPositionWatch(watchId: number | null): void {
    if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
    }
}

/**
 * Check if user is within a certain distance of a target location
 * @param userLat User latitude
 * @param userLng User longitude
 * @param targetLat Target latitude
 * @param targetLng Target longitude
 * @param thresholdKm Distance threshold in kilometers (default 0.05 = 50 meters)
 * @returns Boolean indicating if within threshold
 */
export function isWithinDistance(
    userLat: number,
    userLng: number,
    targetLat: number,
    targetLng: number,
    thresholdKm: number = 0.05
): boolean {
    const distance = haversineDistance(userLat, userLng, targetLat, targetLng);
    return distance <= thresholdKm;
}

/**
 * Sabha Location (BAPS Shri Swaminarayan Mandir, Edison, NJ)
 */
export const SABHA_LOCATION = {
    lat: 40.5186,
    lng: -74.3491,
    address: 'BAPS Shri Swaminarayan Mandir, 1120 Edison Glen Terrace, Edison, NJ 08837',
};

/**
 * Format coordinates for display
 * @param lat Latitude
 * @param lng Longitude
 * @returns Formatted string
 */
export function formatCoordinates(lat: number, lng: number): string {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * Validate coordinates
 * @param lat Latitude
 * @param lng Longitude
 * @returns Boolean indicating if valid
 */
export function isValidCoordinates(lat: number, lng: number): boolean {
    return (
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
    );
}

/**
 * Calculate estimated travel time
 * @param distanceKm Distance in kilometers
 * @param averageSpeedKmh Average speed in km/h (default 30 for city driving)
 * @returns Estimated time in minutes
 */
export function estimateTravelTime(
    distanceKm: number,
    averageSpeedKmh: number = 30
): number {
    const timeHours = distanceKm / averageSpeedKmh;
    return Math.round(timeHours * 60);
}

/**
 * Construct Google Maps directions URL
 * @param origin Starting coordinates
 * @param destination Ending coordinates
 * @param waypoints Intermediate stops
 * @returns Google Maps URL
 */
export function constructGoogleMapsUrl(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    waypoints?: Array<{ lat: number; lng: number }>
): string {
    const baseUrl = 'https://www.google.com/maps/dir/?api=1';
    const originParam = `&origin=${origin.lat},${origin.lng}`;
    const destParam = `&destination=${destination.lat},${destination.lng}`;

    let waypointsParam = '';
    if (waypoints && waypoints.length > 0) {
        waypointsParam =
            '&waypoints=' +
            waypoints.map((wp) => `${wp.lat},${wp.lng}`).join('|');
    }

    return `${baseUrl}${originParam}${destParam}${waypointsParam}&travelmode=driving`;
}

/**
 * Open Google Maps with directions
 * @param origin Starting coordinates
 * @param destination Ending coordinates
 * @param waypoints Intermediate stops
 */
export function openGoogleMaps(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    waypoints?: Array<{ lat: number; lng: number }>
): void {
    const url = constructGoogleMapsUrl(origin, destination, waypoints);
    window.open(url, '_blank');
}
