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
 * **If the server's rule changes, change this too.** `tests/utils/ridePool.test.ts`
 * states the shared rules so a drift is at least caught on one side.
 */

export type RideDirection = 'home-to-sabha' | 'sabha-to-home';

/** An event id is the gathering's own date. Same shape the server validates. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

interface PoolCandidate {
    eventId?: unknown;
    eventDate?: unknown;
    rideType?: unknown;
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
): boolean {
    if (!ride || !eventId || !rideType) return false;
    if (eventKeyOf(ride) !== eventId) return false;
    return directionOf(ride) === rideType;
}
