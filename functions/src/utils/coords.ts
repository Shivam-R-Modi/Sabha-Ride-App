/**
 * Coordinate resolution for user profiles.
 *
 * Home coordinates are written by ProfileSetup as
 * `users/{id}.location.{latitude, longitude}` and read back that way by
 * createRideRequest. But the assignment functions read `{lat, lng}` and
 * normalise both shapes, and some driver records use `homeLocation`. Rather
 * than repeat a `??` chain at each call site and get it subtly wrong in one of
 * them, resolve it in one place.
 */

export interface Coords {
    lat: number;
    lng: number;
}

const isUsable = (n: unknown): n is number =>
    typeof n === 'number' && !Number.isNaN(n);

/**
 * Pull usable home coordinates off a user document, tolerating every shape the
 * codebase writes. Returns null when no usable pair exists — including the
 * 0,0 placeholder, which means "address never geocoded" rather than a point in
 * the Atlantic.
 */
export function resolveHomeCoords(user: any): Coords | null {
    const candidates = [
        // What ProfileSetup actually writes, and what createRideRequest reads.
        { lat: user?.location?.latitude, lng: user?.location?.longitude },
        // The shape the assignment functions use internally.
        { lat: user?.location?.lat, lng: user?.location?.lng },
        // Drivers, and some older records.
        { lat: user?.homeLocation?.lat, lng: user?.homeLocation?.lng },
        { lat: user?.homeLocation?.latitude, lng: user?.homeLocation?.longitude },
    ];

    for (const c of candidates) {
        if (!isUsable(c.lat) || !isUsable(c.lng)) continue;
        if (c.lat === 0 && c.lng === 0) continue;
        return { lat: c.lat, lng: c.lng };
    }

    return null;
}

// zonedDateKey used to live here. It now sits in ./time alongside the other
// zone-aware helpers, so there is one place that knows how to read a clock.
