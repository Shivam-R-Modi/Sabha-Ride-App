import { haversineDistance } from './location';

/**
 * Is this rider actually at the sabha, and how do we know?
 *
 * THE BUG THIS REPLACES
 * ---------------------
 * `studentReadyToLeave` used to refuse anyone whose stored status was not
 * `at_sabha`, and `at_sabha` is written in exactly one place: when a home→sabha
 * ride completes. So the real rule was *"you may request a ride home only if this
 * app drove you here"*, and every rider who walked, drove themselves or got a lift
 * from a friend was permanently locked out. Worse, the button was still shown to
 * them and the failure surfaced as "Please try again" — advice that could never
 * work.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * **Advisory, never enforcing.** A rider is always offered the manual question,
 * including when GPS is confident that they are far away. That is deliberate:
 * being stranded at the temple is worse than a driver making a wasted stop, and a
 * check that can strand somebody is the original bug wearing a new coat.
 *
 * What the GPS buys is a smoother path for the honest majority and a nudge for
 * everyone else — not a guarantee. Nothing here can be trusted against a
 * determined client, so the verdict is recorded rather than relied upon, and a
 * manager can see how each rider got into the queue.
 *
 * PRIVACY
 * -------
 * The coordinates never leave the device. Only the verdict, the method and a
 * rounded distance are sent. This app already holds children's names, phone
 * numbers and home addresses; adding a precise location trail would be a new
 * category of data for no gain, because the fallback means the verdict was never
 * enforceable anyway.
 */

/**
 * How close counts as "at the sabha", in metres.
 *
 * 100m, chosen with the owner on 2026-08-15. Worth knowing what it is competing
 * with: the venue pin is geocoded from a street address, so it can sit on the
 * frontage rather than the middle of the hall, and a phone indoors usually falls
 * back to Wi-Fi positioning that is accurate to tens of metres at best. Riders
 * inside the building or out in the car park will often measure beyond this and
 * land on the manual question. That is the expected path, not a failure.
 */
export const PRESENCE_RADIUS_METERS = 100;

/** How long to wait for a fix before giving up and just asking. */
export const PRESENCE_FIX_TIMEOUT_MS = 6000;

export type PresenceMethod =
    /** Their pickup ride completed, so they are here by definition. */
    | 'pickup'
    /** A GPS fix put them inside the radius. */
    | 'auto'
    /** They said so. Either GPS could not judge, or it disagreed. */
    | 'manual'
    /** An older client that predates this check. Recorded, never blocked. */
    | 'unknown';

export interface PresenceClaim {
    method: PresenceMethod;
    /** Rounded to the nearest 10m. Absent when there was no usable fix. */
    distanceMeters?: number;
    /** What the device said its own error was. */
    accuracyMeters?: number;
}

export interface Fix {
    lat: number;
    lng: number;
    /** Radius of 95% confidence, in metres, as reported by the browser. */
    accuracy: number;
}

export interface Venue {
    lat: number;
    lng: number;
}

export interface Verdict {
    /** True only when we can auto-confirm without asking. */
    confirmed: boolean;
    distanceMeters: number;
    /** Why we could not auto-confirm. Absent when we could. */
    reason?: 'too-far' | 'fix-too-vague';
}

/**
 * Can a fix confirm presence on its own?
 *
 * Pure, and the whole of the decision.
 *
 * The accuracy comparison is not optional politeness. A reading with ±150m of
 * error cannot answer a 100m question — "you are 40m away, give or take 150m"
 * confirms nothing at all. Treating that as a pass would let someone at home
 * through on a vague fix; treating it as a fail would strand somebody standing in
 * the hall. It is neither, so it goes to the manual question.
 */
export function judgeFix(
    fix: Fix,
    venue: Venue,
    radiusMeters: number = PRESENCE_RADIUS_METERS,
): Verdict {
    // haversineDistance answers in kilometres.
    const distanceMeters = haversineDistance(fix.lat, fix.lng, venue.lat, venue.lng) * 1000;
    const rounded = Math.round(distanceMeters / 10) * 10;

    if (!Number.isFinite(fix.accuracy) || fix.accuracy > radiusMeters) {
        return { confirmed: false, distanceMeters: rounded, reason: 'fix-too-vague' };
    }

    if (distanceMeters > radiusMeters) {
        return { confirmed: false, distanceMeters: rounded, reason: 'too-far' };
    }

    return { confirmed: true, distanceMeters: rounded };
}

/**
 * Which venue to measure against.
 *
 * The gathering's own venue wins. A manager can move a single sabha, and
 * measuring that evening against the standing default would put every rider
 * kilometres from where the app thinks they should be — turning a working check
 * into a building-wide outage.
 */
export function venueFor(
    eventVenue: Venue | null | undefined,
    defaultVenue: Venue | null | undefined,
): Venue | null {
    for (const candidate of [eventVenue, defaultVenue]) {
        if (candidate
            && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)
            && !(candidate.lat === 0 && candidate.lng === 0)) {
            return { lat: candidate.lat, lng: candidate.lng };
        }
    }
    return null;
}

/** What the manager sees on the queue. */
export function describePresence(claim: PresenceClaim | null | undefined): string {
    if (!claim) return 'Not recorded';
    switch (claim.method) {
        case 'pickup':
            return 'Arrived by ride';
        case 'auto':
            return `Location confirmed (${claim.distanceMeters ?? '?'}m)`;
        case 'manual':
            return claim.distanceMeters === undefined
                ? 'Confirmed by rider'
                : `Confirmed by rider (GPS read ${formatDistance(claim.distanceMeters)})`;
        default:
            return 'Not recorded';
    }
}

function formatDistance(meters: number): string {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
}
