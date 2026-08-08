// ============================================
// SEAT-AWARE FILL
// ============================================
//
// Dispatch used to take `sortedStudents.slice(0, availableSeats)` — one entry
// per ride document, one seat per entry. A request for a family of four took one
// seat and the driver arrived with room for one.
//
// This module decides, for ONE driver's car, which waiting requests it takes.
// It is pure: no Firestore, no clock, no randomness, so the awkward cases below
// can be pinned by tests rather than discovered on a Friday evening.
//
// ## Why a group can be split across cars, and why that is not a compromise
//
// Dispatch here is driver-PULL: `globalAssignDriver` fires when one driver taps
// "Assign Me", and that tap has no authority over any other driver. So no single
// call can decide "these two cars take this family". Sending two cars to one
// address therefore happens SEQUENTIALLY — the first driver takes what fits, the
// remainder goes back in the waiting pool as an ordinary request, and the next
// driver who taps picks it up.
//
// The alternative is making the family wait for a car big enough to take them
// whole. That is the better outcome when such a car exists, and an infinite wait
// when it does not. Hence the middle rule below.

export type SkipReason =
    /** This car is already full. */
    | 'no-seats-left'
    /** Too big for THIS car, but a vehicle in the fleet could take them whole. */
    | 'waiting-for-bigger-vehicle'
    /** Bigger than any vehicle in the fleet, and the rider asked not to be split.
     *  Nothing can serve this request: it needs a bigger vehicle registered, or
     *  the rider's consent to travel separately. Surfaced to managers rather than
     *  quietly skipped forever. */
    | 'too-large-to-keep-together';

/**
 * Largest number of PASSENGER seats any vehicle in the fleet offers — capacity
 * minus the driver.
 *
 * Counts every vehicle, not just the ones free right now, and that is the point.
 * "Is there a car that could take this family whole?" has to be a fact about the
 * fleet, not about this minute: if it depended on what happened to be free, the
 * same family would be split tonight and kept together next week, for reasons
 * nobody could explain.
 *
 * Returns 0 for an empty or unreadable fleet; fillBySeats treats that as unknown.
 */
export function maxPassengerSeats(capacities: unknown[]): number {
    let best = 0;
    for (const raw of capacities) {
        const capacity = Math.floor(Number(raw));
        if (!Number.isFinite(capacity)) continue;
        best = Math.max(best, capacity - 1);
    }
    return Math.max(0, best);
}

export interface SeatCandidate {
    id: string;
    /** Already normalised through seatsOf(); never absent here. */
    seats: number;
    /** Rider opted out of being split across cars. Defaults to allowed. */
    allowSplit?: boolean;
    /** Part of an already-partly-served group. Used only for ordering. */
    isRemainder?: boolean;
}

export interface SeatTake {
    id: string;
    /** Seats this car takes. Less than `totalSeats` when `split` is true. */
    seats: number;
    /** The full size of the request this came from. */
    totalSeats: number;
    split: boolean;
}

export interface SeatFillResult {
    taken: SeatTake[];
    skipped: Array<{ id: string; seats: number; reason: SkipReason }>;
    seatsUsed: number;
}

/**
 * Put the remainders of already-split groups ahead of everything else,
 * preserving the caller's ordering (distance) within each band.
 *
 * Without this, splitting a group pushes its leftover back into distance
 * competition against untouched requests — so beginning to serve a family can
 * make them wait LONGER overall than one nobody ever touched. Array.sort is
 * stable in Node 18+, which is what keeps the distance ordering inside each band.
 */
export function remaindersFirst<T extends { isRemainder?: boolean }>(list: T[]): T[] {
    return [...list].sort((a, b) => Number(!!b.isRemainder) - Number(!!a.isRemainder));
}

/**
 * Choose what one car takes from an ordered list of waiting requests.
 *
 * @param candidates    Waiting requests, already in the order they should be
 *                      offered (distance, remainders first).
 * @param freeSeats     Passenger seats in THIS car (capacity minus the driver).
 * @param maxFleetSeats Largest passenger capacity of any vehicle in the fleet.
 *                      Decides "wait for a bigger car" versus "no bigger car
 *                      exists, so split". Non-positive or unknown falls back to
 *                      `freeSeats` — see below.
 *
 * A candidate too large for this car is skipped rather than split IF some
 * vehicle could carry it whole; splitting is reserved for groups no vehicle can
 * ever take in one trip. Skipping does not stop the walk: smaller requests
 * behind it are still considered, which is what keeps one large group from
 * blocking the queue.
 */
export function fillBySeats(
    candidates: SeatCandidate[],
    freeSeats: number,
    maxFleetSeats: number,
): SeatFillResult {
    // If the fleet lookup failed we must not conclude "a bigger car exists" — a
    // group would then be skipped by every driver forever, waiting for a vehicle
    // nobody can prove is there. Assuming this car is the largest instead means
    // oversized groups get split and actually travel, which is the recoverable
    // way to be wrong.
    const fleetMax = Number.isFinite(maxFleetSeats) && maxFleetSeats > 0
        ? Math.floor(maxFleetSeats)
        : freeSeats;

    const taken: SeatTake[] = [];
    const skipped: SeatFillResult['skipped'] = [];
    let remaining = Math.max(0, Math.floor(freeSeats));
    const seatsAtStart = remaining;

    for (const c of candidates) {
        if (remaining <= 0) {
            skipped.push({ id: c.id, seats: c.seats, reason: 'no-seats-left' });
            continue;
        }

        if (c.seats <= remaining) {
            taken.push({ id: c.id, seats: c.seats, totalSeats: c.seats, split: false });
            remaining -= c.seats;
            continue;
        }

        // Too big for this car. A bigger one exists, so let them travel together.
        if (c.seats <= fleetMax) {
            skipped.push({ id: c.id, seats: c.seats, reason: 'waiting-for-bigger-vehicle' });
            continue;
        }

        // No vehicle can take this group whole. Splitting is the only way they
        // ever move — unless the rider said not to, in which case say so loudly
        // instead of skipping them every round in silence.
        if (c.allowSplit === false) {
            skipped.push({ id: c.id, seats: c.seats, reason: 'too-large-to-keep-together' });
            continue;
        }

        taken.push({ id: c.id, seats: remaining, totalSeats: c.seats, split: true });
        remaining = 0;
    }

    return { taken, skipped, seatsUsed: seatsAtStart - remaining };
}
