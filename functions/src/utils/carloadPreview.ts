/**
 * What the waiting queue would look like split into cars — for a manager to LOOK at.
 *
 * ── WHY THIS LIVES ON THE SERVER ────────────────────────────────────────────────────
 *
 * Because the answer has to be the same answer dispatch gives. This calls the real
 * `orderForCarload`, `remaindersFirst` and `fillBySeats`, so there is no second
 * implementation to drift from the first. A client-side copy would have been ~200 lines
 * of geometry and seat arithmetic mirrored into the browser, and `hooks/useAutoDispatch`
 * is a monument to how that goes here: dispatch logic in a manager's tab, describing
 * itself as "the Server logic", quietly throwing a ReferenceError for months while the
 * finally block logged "Processing complete".
 *
 * ── WHAT IT CANNOT KNOW, AND SAYS SO ────────────────────────────────────────────────
 *
 * A real carload depends on WHO TAPS. Two inputs come from the tapping Sarthi and
 * nowhere else:
 *
 *   - **their car's free seats**, which decides where a carload gets cut;
 *   - **their home**, because `globalAssignDriver` geo-fences the pool to riders within
 *     GEO_FENCE_MILES of the DRIVER, not the venue.
 *
 * So there is no single true grouping, and this must not pretend otherwise. It takes an
 * explicit list of seat counts — the cars actually free right now — and returns one
 * group per car, each labelled with the seats it assumed. The caller renders that label.
 * Change which car taps first and the split changes; that is a property of the problem,
 * not a defect here, and the UI says it in words.
 *
 * ponytail: THE GEO-FENCE IS NOT APPLIED. Every driver in this congregation lives within
 * about two miles of the venue (see carload.ts), so a 15-mile fence from any of them is
 * within a couple of miles of a 15-mile fence from the venue — the two agree for every
 * rider except one sitting almost exactly on the boundary. Applying it would mean
 * picking a driver's home to measure from, which invents precision this cannot have. The
 * consequence, and it is real: a rider ~15 miles out (the Woburn case) may be shown in a
 * car that the Sarthi who actually taps cannot be given. The upgrade path is taking a
 * driver id and previewing for that Sarthi specifically.
 *
 * ── SPLITS ARE SIMULATED FAITHFULLY ─────────────────────────────────────────────────
 *
 * When a party is too large for any vehicle, `fillBySeats` takes what fits and dispatch
 * writes the rest back as a remainder request. This does the same in memory: the leftover
 * seats stay in the pool marked `isRemainder`, so they get remainder priority in the next
 * round exactly as they would in reality. Dropping them instead would show a family of
 * six as fully served by one four-seater.
 */

import { orderForCarload, Waiting } from './carload';
import { fillBySeats, remaindersFirst, SkipReason } from './seats';

/** A waiting request, as this simulation needs it. */
export interface PreviewRider extends Waiting {
    seats: number;
    /** Rider opted out of travelling in separate cars. Defaults to allowed. */
    allowSplit?: boolean;
}

/** One car's worth. */
export interface PreviewGroup {
    /**
     * Free passenger seats assumed for this car.
     *
     * Published so the row can say "4-seater" rather than implying the grouping is
     * absolute. It is the whole of this function's honesty.
     */
    seats: number;
    /**
     * The rider this carload was built around — farthest from the venue, or a
     * remainder, or someone past the wait threshold. See `chooseSeed`.
     *
     * Worth showing: it is the one rider whose position explains the shape of the
     * whole car, and a manager asking "why those three" is asking about this rider.
     *
     * NULL WHEN THE ANCHOR IS NOT IN THE CAR. The seed can be skipped — too large for
     * this car while a bigger one exists — and the ordering still grew outward from
     * where they live. Geometrically it is still the anchor, but a label reading
     * "anchored on Ramesh" above a list with no Ramesh in it reads as a bug, so the
     * caller is given nothing to render instead of something wrong.
     */
    anchorId: string | null;
    riders: Array<{
        id: string;
        /** Seats this car takes. Fewer than `totalSeats` when `split`. */
        seats: number;
        totalSeats: number;
        split: boolean;
    }>;
}

export interface CarloadPreview {
    groups: PreviewGroup[];
    /**
     * Riders no car in `carSeats` reaches, each with the reason.
     *
     * A REASON PER RIDER, never a bare count. "Nobody picked them up" and "no vehicle
     * in the fleet seats this many and they asked not to be split" look identical in a
     * list and need completely different actions from a manager — the second one cannot
     * resolve itself, ever, and is the failure this queue has been bitten by before.
     */
    leftover: Array<{ id: string; seats: number; reason: SkipReason | 'no-car-left' }>;
}

/**
 * Split the waiting pool into carloads, one per seat count given.
 *
 * @param pool       Every request eligible for this hall and direction. Already
 *                   filtered by the caller with the same predicate dispatch uses.
 * @param venue      This hall's venue — what "farthest" is measured from.
 * @param carSeats   Free passenger seats of each car to simulate, in the order they
 *                   are assumed to tap. Empty means no cars, so everybody is leftover.
 * @param maxFleetSeats Largest passenger capacity in the fleet, deciding "wait for a
 *                   bigger car" versus "split". Passed through to `fillBySeats`.
 */
export function previewCarloads(
    pool: readonly PreviewRider[],
    venue: { lat: number; lng: number },
    carSeats: readonly number[],
    maxFleetSeats: number,
    now: number = Date.now(),
): CarloadPreview {
    const groups: PreviewGroup[] = [];
    let remaining: PreviewRider[] = pool.filter(r =>
        Number.isFinite(r.lat) && Number.isFinite(r.lng));

    // A rider with no coordinates cannot be placed in a carload by an algorithm that
    // works in miles, and dispatch would put them nowhere either. Reported rather than
    // silently absent, because an address that never geocoded is a fixable thing and
    // invisible otherwise.
    const leftover: CarloadPreview['leftover'] = pool
        .filter(r => !(Number.isFinite(r.lat) && Number.isFinite(r.lng)))
        .map(r => ({ id: r.id, seats: r.seats, reason: 'no-car-left' as const }));

    for (const seats of carSeats) {
        if (remaining.length === 0) break;

        // The same three calls, in the same order, as globalAssignDriver step 5–7b.
        const ordered = remaindersFirst(orderForCarload(remaining, venue, now));
        const { taken } = fillBySeats(
            ordered.map(r => ({
                id: r.id,
                seats: r.seats,
                allowSplit: r.allowSplit,
                isRemainder: r.isRemainder,
            })),
            seats,
            maxFleetSeats,
        );

        if (taken.length === 0) {
            // This car can take nobody — every remaining request is larger than it and
            // a bigger vehicle exists. Skipping to the next car is right; stopping here
            // would hide the riders a later, bigger car would reach.
            continue;
        }

        groups.push({
            seats,
            // The seed, which is `ordered[0]`: `chooseSeed` already ranks remainders
            // first, so `remaindersFirst` is stable over an ordering that starts with
            // one and cannot displace it. Reported only if they are actually aboard.
            anchorId: taken.some(t => t.id === ordered[0].id) ? ordered[0].id : null,
            riders: taken.map(t => ({
                id: t.id, seats: t.seats, totalSeats: t.totalSeats, split: t.split,
            })),
        });

        const takenById = new Map(taken.map(t => [t.id, t]));
        remaining = remaining.flatMap(r => {
            const take = takenById.get(r.id);
            if (!take) return [r];
            if (!take.split) return [];
            // The half left behind. Marked a remainder so the next round gives it
            // remainder priority, which is what dispatch does when it writes the
            // leftover back as its own request.
            return [{ ...r, seats: r.seats - take.seats, isRemainder: true }];
        });
    }

    // Whatever is still waiting after every car has been simulated. Re-run the fill
    // against the LAST car so each rider carries a reason a manager can act on, rather
    // than all of them reading "no car left" when the real answer is that no vehicle in
    // the fleet is big enough.
    if (remaining.length > 0) {
        const lastSeats = carSeats.length > 0 ? carSeats[carSeats.length - 1] : 0;
        const { skipped } = fillBySeats(
            remaining.map(r => ({
                id: r.id, seats: r.seats, allowSplit: r.allowSplit, isRemainder: r.isRemainder,
            })),
            lastSeats,
            maxFleetSeats,
        );
        const reasonById = new Map(skipped.map(s => [s.id, s.reason]));
        for (const r of remaining) {
            leftover.push({
                id: r.id,
                seats: r.seats,
                // 'no-seats-left' from that last fill means "this car was already full",
                // which for the queue as a whole is simply "no car left".
                reason: reasonById.get(r.id) === 'no-seats-left' || !reasonById.has(r.id)
                    ? 'no-car-left'
                    : reasonById.get(r.id)!,
            });
        }
    }

    return { groups, leftover };
}
