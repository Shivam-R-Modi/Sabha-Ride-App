/**
 * Fetch the Sabha location from the Firestore settings document.
 * Falls back to a default if the document doesn't exist or is missing data.
 */
import * as admin from 'firebase-admin';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './time';
import { DEFAULT_REQUESTS_OPEN_TIME, parseTimeToMinutes } from './schedule';
import { FOUNDING_LOCATION_ID } from '../constants/tenancy';
import {
    activeLocations, normaliseLocation, type SabhaLocationRecord,
} from './locations';

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

/**
 * The zone the congregation's clocks are in.
 *
 * Anything deriving a calendar date needs this, because the server clock is UTC
 * and rolls over mid-evening in the Americas. An unrecognised zone falls back
 * rather than throwing: `Intl` rejects a bad zone at format time, which would
 * turn a typo in a settings document into a failing ride completion.
 */
export async function getTimeZone(): Promise<string> {
    try {
        const db = admin.firestore();
        const snap = await db.collection('settings').doc('main').get();
        const configured = snap.data()?.timeZone;

        if (typeof configured === 'string' && isValidTimeZone(configured)) {
            return configured;
        }
        return DEFAULT_TIME_ZONE;
    } catch (err) {
        console.error('[getTimeZone] Error fetching settings:', err);
        return DEFAULT_TIME_ZONE;
    }
}

/**
 * The time of day ride requests open, on the lead day. "HH:MM" local.
 *
 * Same fall-back-rather-than-throw shape as `getTimeZone` above, and for the same
 * reason: this is read inside a scheduled job that decides whether rides are open at
 * all, so a typo in a settings document must not be able to stop the window opening.
 */
export async function getRequestsOpenTime(): Promise<string> {
    try {
        const db = admin.firestore();
        const snap = await db.collection('settings').doc('main').get();
        const configured = snap.data()?.requestsOpenTime;

        if (parseTimeToMinutes(configured) !== null) return configured as string;
        return DEFAULT_REQUESTS_OPEN_TIME;
    } catch (err) {
        console.error('[getRequestsOpenTime] Error fetching settings:', err);
        return DEFAULT_REQUESTS_OPEN_TIME;
    }
}

export const LOCATIONS_COLLECTION = 'locations';

/**
 * Every hall currently open for business, in display order.
 *
 * RETURNS WHAT IS THERE, INCLUDING NOTHING. An empty list means the seed has not run
 * or every document is malformed, and that is a fault the caller must handle rather
 * than something this function papers over — see `locationsOrFoundingFallback`, which
 * is the one place the bridge lives.
 *
 * Reads the whole collection. There are two or three of these documents, not two
 * thousand, so there is nothing to page and no index to miss.
 */
export async function getActiveLocations(
    db?: admin.firestore.Firestore,
): Promise<SabhaLocationRecord[]> {
    try {
        const snap = await (db ?? admin.firestore()).collection(LOCATIONS_COLLECTION).get();
        const records = snap.docs
            .map(d => normaliseLocation(d.id, d.data()))
            .filter((r): r is SabhaLocationRecord => r !== null);
        return activeLocations(records);
    } catch (err) {
        console.error('[getActiveLocations] Error reading locations:', err);
        return [];
    }
}

/**
 * The halls to work with, with a bridge for the release before the seed lands.
 *
 * THE BRIDGE IS DELIBERATE AND TIME-BOXED. This ships in the same deploy as the code
 * that reads `locations`, and the collection is seeded by `scripts/locations.cjs` — two
 * separate acts, in an order that cannot be guaranteed. Between them, an empty
 * collection would mean no hall, which would mean no gathering and no rides on a Friday
 * evening. So an empty collection synthesises the founding hall from
 * `settings/main.sabhaLocation`, which is exactly where the venue came from before
 * locations existed.
 *
 * IT LOGS AS AN ERROR, not a debug line, because after the seed has run this branch
 * means somebody deleted or deactivated every hall — and the plausible-looking
 * behaviour that follows would otherwise be the only symptom.
 */
export async function locationsOrFoundingFallback(
    db?: admin.firestore.Firestore,
): Promise<SabhaLocationRecord[]> {
    const halls = await getActiveLocations(db);
    if (halls.length > 0) return halls;

    const venue = await getSabhaLocation();
    console.error(
        '[locations] NO ACTIVE SABHA LOCATION. Falling back to the founding hall from '
        + 'settings/main. Run `node scripts/locations.cjs seed` — after that has run, '
        + 'this line means every hall has been deleted or deactivated.',
    );
    return [{
        id: FOUNDING_LOCATION_ID,
        name: 'Sabha',
        venue,
        active: true,
        order: 0,
    }];
}

/**
 * One hall by id, or null.
 *
 * Null rather than the founding hall: a caller asking for a specific hall has an id
 * from somewhere — a ride, a driver's tap — and quietly answering with a different
 * hall's coordinates is how a car ends up at the wrong building.
 */
export async function getLocation(
    locationId: string,
    db?: admin.firestore.Firestore,
): Promise<SabhaLocationRecord | null> {
    try {
        const snap = await (db ?? admin.firestore())
            .collection(LOCATIONS_COLLECTION).doc(locationId).get();
        return snap.exists ? normaliseLocation(snap.id, snap.data()) : null;
    } catch (err) {
        console.error(`[getLocation] Error reading ${locationId}:`, err);
        return null;
    }
}
