/**
 * WHICH WAITING REQUESTS A TAP MAY BE HANDED, AND WHY EACH REFUSED ONE WAS REFUSED.
 *
 * Moved out of http/globalAssignDriver.ts, which imports `firebase-functions` and so
 * could not be imported by a test comparing it against the client's copy. That copy —
 * `src/utils/ridePool.ts` — has carried the note *"If the server's rule changes, change
 * this too"* since it was written, with nothing tying the two together. There is a
 * parity test now: tests/quality/ride-pool-parity.test.ts.
 *
 * The behaviour is unchanged from globalAssignDriver's version except for the hall, and
 * both functions are re-exported from there so no call site or existing test had to
 * move.
 *
 * ── WHY REFUSALS CARRY A REASON ─────────────────────────────────────────────────────
 *
 * A boolean predicate over the pool means every refusal collapses into the same screen:
 * "Nobody is waiting right now". That is the failure this file's own history is about —
 * on 2026-08-14 a manager read `Waiting · 4` beside a driver being told nobody was
 * waiting, and went looking for a fault in dispatch. `globalAssignDriver` already
 * aggregates skipped requests into a `waiting` array by reason and the driver's screen
 * renders it, so a reason here reaches a human: *"nobody waiting for this sabha; 3
 * groups are waiting at the other one"* is actionable. Counts only, never names — same
 * privacy rule the rest of that screen follows.
 */

import { eventKeyFromRide } from './events';
import { locationOfRide } from './locations';
import type { RideType } from '../types';

/** Why a waiting request is not available to this tap. `null` means it is. */
export type PoolRejection =
    /** No usable pickup coordinates, or the `0,0` "never geocoded" placeholder. */
    | 'no-coords'
    /** No `studentId` — not a real request. */
    | 'no-rider'
    /** For a different evening, past or future. */
    | 'other-gathering'
    /** A pickup during drop-off, or the reverse. */
    | 'other-direction'
    /** Bound for a different sabha location. */
    | 'other-location'
    /** Names no location, and more than one is open so it cannot be inferred. */
    | 'no-location'
    /** The caller's own request. A driver is never their own passenger. */
    | 'own-request';

export interface PoolExpectation {
    /** The gathering's DATE, from `system/rideContext`. Null skips the check. */
    eventKey: string | null;
    rideType: RideType;
    /** The hall this run is for. Null skips the check. */
    locationId: string | null;
    /**
     * Is exactly one sabha location open for business?
     *
     * THIS IS WHAT MAKES AN UNSTAMPED REQUEST SAFE, and it is a fact rather than a
     * feature flag on purpose. `locationId` is optional in firestore.rules for one
     * release so a cached client that predates the hall picker can still file a ride —
     * and such a request names no hall.
     *
     * With ONE hall open there is no ambiguity: the request can only be for that hall,
     * so dispatching it is correct and refusing it would strand a rider over a field
     * they had no way to send. With TWO open it is genuinely unknowable, and guessing
     * sends a car to the wrong building — so it is refused, loudly, as 'no-location'.
     *
     * Derived from the data every time. A boolean constant here would be one more thing
     * to forget to flip on the evening it starts mattering.
     */
    singleActiveLocation: boolean;
    /** The tapping driver, so they cannot be handed their own request. */
    driverId?: string;
}

/**
 * Why this request is unavailable, or null when it is available.
 *
 * Ordered so the reason a human is shown is the most specific true one: a request with
 * no rider is not "for another hall", it is not a request.
 */
export function rejectionFor(docData: any, expected: PoolExpectation): PoolRejection | null {
    if (!docData) return 'no-rider';
    if (expected.driverId && docData.studentId === expected.driverId) return 'own-request';

    // "Is this a request at all" BEFORE "can we route to it". An empty document has
    // neither a rider nor coordinates, and 'no-rider' is the more useful of the two
    // true answers — the boolean result is the same either way, only the reason a human
    // reads changes.
    if (!docData.studentId) return 'no-rider';

    const lat = docData.pickupLat ?? 0;
    const lng = docData.pickupLng ?? 0;
    if (typeof lat !== 'number' || typeof lng !== 'number') return 'no-coords';
    if (isNaN(lat) || isNaN(lng)) return 'no-coords';
    if (lat === 0 && lng === 0) return 'no-coords';

    // Reuses eventKeyFromRide so `eventId` and `eventDate` are read in the same
    // priority order, and validated against the same YYYY-MM-DD shape, as everywhere
    // else that works out which gathering a ride belongs to. NOTE it returns a DATE:
    // `rides.eventId` deliberately holds the date rather than a suffixed event id, so
    // the evening and the hall stay two separate facts. See utils/locations.ts.
    if (expected.eventKey && eventKeyFromRide(docData) !== expected.eventKey) {
        return 'other-gathering';
    }

    // Anything that is not one of the two known directions is rejected rather than
    // defaulted — a hand-edited 'sabha-to-Home' should strand one request visibly, not
    // quietly join whichever run is open. An ABSENT rideType means 'home-to-sabha',
    // and that default is load-bearing: every pickup request ever written lacks the
    // field, so treating absent as "no match" would refuse every genuine request.
    const direction = docData.rideType ?? 'home-to-sabha';
    if (direction !== expected.rideType) return 'other-direction';

    if (expected.locationId) {
        const hall = locationOfRide(docData);
        if (hall === null) {
            // Safe only while one hall is open — see `singleActiveLocation`.
            if (!expected.singleActiveLocation) return 'no-location';
        } else if (hall !== expected.locationId) {
            return 'other-location';
        }
    }

    return null;
}

/**
 * Is this pending ride dispatchable for the gathering we are dispatching?
 *
 * The GPS checks were the whole of this function once, and that was a real hole: a
 * `requested` ride is only ever filtered by `status`, so a request left over from a
 * PREVIOUS sabha stayed in the pool for ever and would be handed to the next driver who
 * tapped. Three were live in production on 2026-08-14, five days after their gathering,
 * and a tap would have routed a driver to collect people for a sabha that had already
 * happened.
 *
 * A ride with NO event key at all is rejected, deliberately. Every client that creates
 * a request stamps `date` and `eventDate`, and `studentReadyToLeave` stamps `eventDate`
 * server-side, so an unkeyed request either predates that or was hand-written in the
 * console. Refusing it means such a ride is never dispatched; accepting it means it is
 * dispatched to every gathering for ever. **The first failure is visible to a manager in
 * the Waiting queue, the second sends a car to the wrong place.** That sentence is also
 * the argument for refusing a mismatched hall.
 */
export function isValidPendingRide(
    docData: any,
    expectedEventKey: string | null,
    expectedRideType: RideType,
    expectedLocationId: string | null = null,
    singleActiveLocation = true,
): boolean {
    return rejectionFor(docData, {
        eventKey: expectedEventKey,
        rideType: expectedRideType,
        locationId: expectedLocationId,
        singleActiveLocation,
    }) === null;
}

/**
 * May this waiting request enter THIS driver's pool?
 *
 * `isValidPendingRide` answers "is this request real and for tonight" — a property of
 * the ride alone. This adds the one property that depends on who is asking:
 * A DRIVER IS NEVER THEIR OWN PASSENGER.
 *
 * The hierarchy in firestore.rules deliberately grants a driver the student role and a
 * manager both, so a Sarthi can see the rider screens. Nothing stopped them requesting
 * a ride there, and this pool was every waiting request with no exclusion of the
 * caller. A Sarthi could switch to Bhulku, request a ride, switch back and be assigned
 * themselves: a phantom passenger holding a real seat in their own car, their own
 * address on the manifest, and a served count including somebody never collected.
 *
 * Kept separate rather than folded in because the two ask different questions, and
 * because `driverDoneForToday` counts who is still waiting — a count that must exclude
 * the caller's own request for the same reason.
 */
export function isAssignableTo(
    docData: any,
    driverId: string,
    expectedEventKey: string | null,
    expectedRideType: RideType,
    expectedLocationId: string | null = null,
    singleActiveLocation = true,
): boolean {
    return rejectionFor(docData, {
        eventKey: expectedEventKey,
        rideType: expectedRideType,
        locationId: expectedLocationId,
        singleActiveLocation,
        driverId,
    }) === null;
}
