/**
 * How many seats one ride request may ask for. Client mirror of
 * functions/src/constants/seats.ts — separate tsconfigs, no shared path, so the
 * two files must hold the same values.
 *
 * See the server copy for why `seatsRequested` is optional and absent means one.
 * The short version: it makes every ride written before this release, and every
 * ride from a client that has not updated yet, behave exactly as it does today,
 * so there is no backfill and no half-migrated window.
 *
 * MIN/MAX bound what the rider may type in PickupForm; firestore.rules enforces
 * the same range server-side, because a client-only bound is a suggestion.
 */

export const MIN_SEATS = 1;
export const MAX_SEATS = 8;
export const DEFAULT_SEATS = 1;

/**
 * Largest number of PASSENGER seats any vehicle in the fleet offers — capacity
 * minus the driver. Mirror of the server's maxPassengerSeats in
 * functions/src/utils/seats.ts, which is what dispatch actually decides on; this
 * copy only labels the manager's queue.
 *
 * Counts every vehicle, not just the free ones: "could a car take this family
 * whole?" is a fact about the fleet, not about this minute.
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

/** Seat count for a ride, tolerating absent / null / string / non-integer. */
export function seatsOf(ride: { seatsRequested?: unknown } | null | undefined): number {
    const raw = Number(ride?.seatsRequested);
    if (!Number.isFinite(raw)) return DEFAULT_SEATS;
    const whole = Math.floor(raw);
    if (whole < MIN_SEATS) return DEFAULT_SEATS;
    return Math.min(whole, MAX_SEATS);
}

interface RideLike {
    students?: unknown;
    peers?: unknown;
    seatsRequested?: unknown;
}

/**
 * People a ride is carrying, read off its roster.
 *
 * Four screens each counted `students.length` — the driver's active ride, their
 * history, the history total and the manager's report — so a car carrying a
 * family of four reported "1 student". They also each invented their own
 * fallback for rides with no roster; those fallbacks are preserved here, in one
 * place, in the same order:
 *
 *   roster seats  →  peers + 1 (the rider themselves)  →  the ride's own count
 *
 * so a ride written before seats existed reads exactly as it did before.
 */
export function seatsOnRide(ride: RideLike | null | undefined): number {
    const roster = Array.isArray(ride?.students) ? ride.students : null;
    if (roster && roster.length > 0) {
        return roster.reduce(
            (n: number, s: unknown) => n + seatsOf({ seatsRequested: (s as { seats?: unknown })?.seats }),
            0,
        );
    }

    const peers = Array.isArray(ride?.peers) ? ride.peers.length : 0;
    if (peers > 0) return peers + 1;

    return seatsOf(ride);
}
