/**
 * Ticking off stops from where the car is.
 *
 * WHAT THIS CAN AND CANNOT KNOW
 * -----------------------------
 * The Sarthi drives with Google Maps, not with this app open — and a web page
 * gets no location at all while it is in the background. A service worker cannot
 * read location either. So there is no trail: each time the Sarthi glances back
 * at the app, one fresh fix arrives saying where the car is *right now*, and
 * whatever happened between glances is simply not observable.
 *
 * That is why this is **display only**. Reaching a house is not proof anybody got
 * in it, and missing a house is not proof anybody was left behind. The record of
 * who actually travelled is the roster the Sarthi confirms at the venue. This
 * module exists so that on a normal night that confirmation is one tap on a
 * screen that already looks right, instead of four taps on a screen that looks
 * blank.
 *
 * Built on `judgeFix` from ./presence rather than a bare distance check, because
 * the accuracy guard is the whole difference between useful and harmful here: a
 * reading good to ±300m cannot tell one neighbour's house from another's, and a
 * stop that ticks itself off while the Sarthi is parked at the wrong address
 * leaves a child standing outside.
 */

import { judgeFix, PRESENCE_RADIUS_METERS, type Fix } from './presence';

/**
 * The shape this needs from a route waypoint — structurally what both `Waypoint`
 * in types.ts and the `route` prop on ActiveRide already are, without importing
 * either. Kept local so the module stays pure and trivially testable.
 */
export interface ProgressWaypoint {
    lat: number;
    lng: number;
    type: 'start' | 'pickup' | 'dropoff' | 'end';
    studentId?: string;
    visited: boolean;
}

export interface ProgressResult<T extends ProgressWaypoint> {
    waypoints: T[];
    /** Riders whose stop flipped to visited *on this call*, never on a later one. */
    newlyVisitedStudentIds: string[];
    /** False means the caller can skip the Firestore write entirely. */
    changed: boolean;
}

/**
 * Advance the ticks for one location fix.
 *
 * Never un-ticks. The car drives away from every house it visits, so a stop that
 * cleared itself once the car moved on would undo both this and the Sarthi's own
 * manual tick, on every single run.
 *
 * `start` and `end` are left alone: the start is not a stop, and arrival at the
 * venue is confirmed by the Sarthi, not by GPS.
 *
 * ponytail: every stop within the radius ticks on the same fix, so two homes
 * closer together than the radius tick together. Harmless while this is display
 * only and the venue roster is the record — if that ever changes, tick only the
 * nearest unvisited stop and require consecutive fixes to agree.
 */
export function advanceVisits<T extends ProgressWaypoint>(
    waypoints: T[],
    fix: Fix,
    radiusMeters: number = PRESENCE_RADIUS_METERS,
): ProgressResult<T> {
    const newlyVisitedStudentIds: string[] = [];

    const advanced = waypoints.map(wp => {
        if (wp.visited || (wp.type !== 'pickup' && wp.type !== 'dropoff')) return wp;
        if (!judgeFix(fix, wp, radiusMeters).confirmed) return wp;

        if (wp.studentId) newlyVisitedStudentIds.push(wp.studentId);
        return { ...wp, visited: true };
    });

    // A stop with no studentId still counts as progress, so `changed` is measured
    // from the waypoints and not from the id list.
    const changed = advanced.some((wp, idx) => wp !== waypoints[idx]);

    return { waypoints: changed ? advanced : [...waypoints], newlyVisitedStudentIds, changed };
}

/**
 * Is the car at the end of the route?
 *
 * The end is the sabha on the way there and the Sarthi's own home on the way
 * back, so this answers "the driving is done" for both legs. Used only to open
 * the confirmation sheet — a false positive would throw a dialog over a screen
 * being read at the wheel, which is why the vague-fix refusal matters as much
 * here as anywhere.
 */
export function hasReachedEnd(
    waypoints: ProgressWaypoint[],
    fix: Fix,
    radiusMeters: number = PRESENCE_RADIUS_METERS,
): boolean {
    const end = waypoints.find(wp => wp.type === 'end');
    return end ? judgeFix(fix, end, radiusMeters).confirmed : false;
}
