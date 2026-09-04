/**
 * Would dispatch consider this waiting request?
 *
 * WHY THE CLIENT NEEDS THIS AT ALL
 * --------------------------------
 * `globalAssignDriver` filters the pool it dispatches from by the gathering and
 * the direction, both read from `system/rideContext`. The manager's Waiting queue
 * did not filter at all — it listed every `requested` ride in the collection.
 *
 * So the two disagreed, and visibly: on 2026-08-14 the queue read "Waiting · 4"
 * while a driver tapping Assign Me was told "Nobody is waiting right now". Four
 * riders appeared to be queued whom no tap could ever serve, because they had
 * asked for a pickup and the window had moved on to drop-off.
 *
 * A count that cannot be acted on is worse than no count: it sends a manager
 * looking for a fault in dispatch.
 *
 * MIRROR
 * ------
 * This mirrors `isValidPendingRide` in
 * `functions/src/http/globalAssignDriver.ts`, minus the GPS checks — a request
 * with no usable coordinates is still a real person waiting, and the manager
 * should see them even though no driver can be routed to them. The two files
 * cannot import from each other: separate tsconfigs, no shared path. Same
 * arrangement as `src/constants/seats.ts` and its `functions/` twin.
 *
 * **If the server's rule changes, change this too.** That sentence stood alone for
 * months; there is a check now — `tests/quality/ride-pool-parity.test.ts` runs both
 * copies over the same table and compares the answers. The server half had to move out
 * of `globalAssignDriver.ts` into `functions/src/utils/ridePool.ts` to make that
 * possible, because that file imports `firebase-functions`.
 *
 * The GPS difference is the ONE deliberate divergence and the parity test knows about
 * it by name, so it cannot quietly become a second one.
 */

import { locationOfRide } from './locations';

export type RideDirection = 'home-to-sabha' | 'sabha-to-home';

/** An event id is the gathering's own date. Same shape the server validates. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

interface PoolCandidate {
    eventId?: unknown;
    eventDate?: unknown;
    rideType?: unknown;
    locationId?: unknown;
}

/**
 * Which gathering a ride belongs to, or null when it cannot say.
 *
 * `eventId` before `eventDate`: the server writes the first when a ride is
 * assigned, the browser writes the second when it is requested. Same priority
 * order as `eventKeyFromRide` in `functions/src/utils/events.ts`.
 */
export function eventKeyOf(ride: PoolCandidate | null | undefined): string | null {
    if (!ride) return null;
    for (const candidate of [ride.eventId, ride.eventDate]) {
        if (typeof candidate === 'string' && DATE_KEY.test(candidate)) return candidate;
    }
    return null;
}

/**
 * Which direction this rider asked for.
 *
 * ABSENT MEANS `home-to-sabha`, and that default is load-bearing rather than
 * defensive: a pickup request carries no `rideType` at all — `hooks/useRides.ts`
 * has never written one — while `studentReadyToLeave` stamps `sabha-to-home`.
 * Treating absent as "unknown" would hide every genuine pickup from the queue.
 */
export function directionOf(ride: PoolCandidate | null | undefined): string {
    const raw = ride?.rideType;
    return typeof raw === 'string' && raw ? raw : 'home-to-sabha';
}

/**
 * True when dispatch would currently consider this request.
 *
 * A null `eventId` or `rideType` means the server has not published a window —
 * nothing is dispatchable then, and saying so is more useful than showing a
 * queue nobody can act on.
 */
export function isDispatchable(
    ride: PoolCandidate | null | undefined,
    eventId: string | null,
    rideType: RideDirection | null,
    locationId: string | null = null,
    singleActiveLocation = true,
): boolean {
    if (!ride || !eventId || !rideType) return false;
    if (eventKeyOf(ride) !== eventId) return false;
    if (directionOf(ride) !== rideType) return false;

    /**
     * WHICH SABHA LOCATION, mirroring `rejectionFor` in
     * functions/src/utils/ridePool.ts.
     *
     * `locationId` null skips the check, which is the state until the manager's queue
     * learns to group by hall — an unused optional parameter rather than a second rule
     * to keep in step later.
     *
     * A request naming NO hall is dispatchable only while one hall is open, where it
     * cannot be ambiguous. `locationId` is optional in firestore.rules for one release
     * so a cached client predating the picker can still file a ride, and such a request
     * names none. With two halls open, guessing sends a car to the wrong building.
     */
    if (locationId) {
        const hall = locationOfRide(ride);
        if (hall === null) return singleActiveLocation;
        if (hall !== locationId) return false;
    }
    return true;
}
