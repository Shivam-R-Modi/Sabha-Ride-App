// ============================================
// GOOGLE MAPS INTEGRATION
// Build navigation URLs and handle map features
// ============================================

interface Waypoint {
    lat: number;
    lng: number;
    name: string;
    type: 'start' | 'pickup' | 'dropoff' | 'end';
    studentId?: string;
    visited: boolean;
}

/**
 * Build Google Maps URL for navigation with waypoints
 * Opens external Google Maps app/website with route pre-loaded
 * 
 * @param waypoints - Ordered array of waypoints (start, pickups/dropoffs, end)
 * @returns Google Maps URL
 */
export function buildGoogleMapsNavigationUrl(waypoints: Waypoint[]): string {
    if (waypoints.length < 2) {
        console.error('Need at least 2 waypoints for navigation');
        return '';
    }

    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;

    // Middle waypoints (if any)
    const middleWaypoints = waypoints.slice(1, -1);
    let waypointsParam = '';

    if (middleWaypoints.length > 0) {
        const waypointStr = middleWaypoints
            .map(wp => `${wp.lat},${wp.lng}`)
            .join('|');
        waypointsParam = `&waypoints=${encodeURIComponent(waypointStr)}`;
    }

    // Use the directions URL format for better compatibility
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=driving`;
}

/**
 * Open Google Maps in a new tab/window
 */
export function openGoogleMaps(url: string): void {
    if (!url) {
        console.error('No Google Maps URL provided');
        return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Build Google Maps URL for a single location (for viewing)
 */
export function buildGoogleMapsLocationUrl(lat: number, lng: number, label?: string): string {
    const query = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`;
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * Build static map image URL (for preview without API key)
 * Note: For production, you should use Google Maps Static API with an API key
 */
export function buildStaticMapUrl(
    waypoints: Waypoint[],
    width: number = 600,
    height: number = 400
): string {
    if (waypoints.length === 0) return '';

    // Using a free alternative (OpenStreetMap) for static maps
    // For Google Maps Static API, you need an API key

    const center = waypoints[Math.floor(waypoints.length / 2)];
    const markers = waypoints
        .map((wp, index) => {
            const color = index === 0 ? 'green' : index === waypoints.length - 1 ? 'red' : 'blue';
            return `marker=${color}|${wp.lat},${wp.lng}`;
        })
        .join('&');

    // Using Static Map API format (requires API key for Google)
    // This is a placeholder - replace with actual Google Maps Static API call
    return `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat},${center.lng}&zoom=13&size=${width}x${height}&${markers}&path=color:0x0000ff|weight:5|${waypoints.map(wp => `${wp.lat},${wp.lng}`).join('|')}`;
}

/**
 * Calculate estimated arrival time
 */
export function calculateETA(durationMinutes: number): string {
    const now = new Date();
    const arrivalTime = new Date(now.getTime() + durationMinutes * 60000);

    return arrivalTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Format distance for display
 */
export function formatDistance(kilometers: number): string {
    if (kilometers < 1) {
        return `${Math.round(kilometers * 1000)} m`;
    }
    return `${Math.round(kilometers * 10) / 10} km`;
}

/**
 * Format duration for display
 */
export function formatDuration(minutes: number): string {
    if (minutes < 60) {
        return `${Math.round(minutes)} mins`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${hours} hr${hours > 1 ? 's' : ''} ${remainingMinutes} min${remainingMinutes > 1 ? 's' : ''}`;
}
