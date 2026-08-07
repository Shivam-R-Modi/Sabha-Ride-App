/**
 * Fetch the Sabha location from the Firestore settings document.
 * Falls back to a default if the document doesn't exist or is missing data.
 */
import * as admin from 'firebase-admin';

export interface SabhaLocation {
    lat: number;
    lng: number;
    address: string;
}

const DEFAULT_SABHA_LOCATION: SabhaLocation = {
    lat: 42.339925,
    lng: -71.088182,
    address: '360 Huntington Ave, Boston, MA 02115',
};

/**
 * Pick the venue to use, preferring the more specific source.
 *
 * The chain is `ride.venue → event venue → settings/main → DEFAULT`, and every
 * link is a widening: with no per-event override set anywhere this returns
 * exactly what the app used before per-event venues existed, which is why the
 * change needs no backfill.
 *
 * Rejects 0,0 for the same reason `resolveHomeCoords` does — it is the "address
 * never geocoded" placeholder, not a point in the Atlantic.
 */
export function resolveVenue(
    candidate: unknown,
    fallback: SabhaLocation,
): SabhaLocation {
    const usable = (v: any): boolean =>
        !!v
        && Number.isFinite(v.lat) && Number.isFinite(v.lng)
        && !(v.lat === 0 && v.lng === 0);

    if (usable(candidate)) {
        const c = candidate as any;
        return {
            lat: c.lat,
            lng: c.lng,
            address: typeof c.address === 'string' && c.address
                ? c.address
                : fallback.address,
        };
    }

    return usable(fallback) ? fallback : DEFAULT_SABHA_LOCATION;
}

/**
 * Read `settings/main` from Firestore and return the Sabha location.
 * Used by Cloud Functions that need the current venue coordinates.
 */
export async function getSabhaLocation(): Promise<SabhaLocation> {
    try {
        const db = admin.firestore();
        const snap = await db.collection('settings').doc('main').get();

        if (!snap.exists) {
            console.warn('[getSabhaLocation] settings/main not found — using default');
            return DEFAULT_SABHA_LOCATION;
        }

        const data = snap.data();
        const loc = data?.sabhaLocation;

        if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
            return {
                lat: loc.lat,
                lng: loc.lng,
                address: loc.address || DEFAULT_SABHA_LOCATION.address,
            };
        }

        console.warn('[getSabhaLocation] Invalid sabhaLocation in settings — using default');
        return DEFAULT_SABHA_LOCATION;
    } catch (err) {
        console.error('[getSabhaLocation] Error fetching settings:', err);
        return DEFAULT_SABHA_LOCATION;
    }
}
