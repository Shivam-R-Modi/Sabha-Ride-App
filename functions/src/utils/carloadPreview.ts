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
 * So it takes CARS, not seat counts: each one a Sarthi actually holding a vehicle, with
 * their seats and the home their fence is measured from. Given those, the only thing left
 * unknown is the ORDER they tap in — and the split genuinely depends on it, so every group
 * is labelled with whose car it is and the UI says it re-forms on every tap.
 *
 * ── THE GEO-FENCE IS APPLIED, PER CAR ───────────────────────────────────────────────
 *
 * `globalAssignDriver` will not send a volunteer more than `GEO_FENCE_MILES` from their
 * own home, and that bound decides who is even ELIGIBLE for a given Sarthi — so a
 * preview without it shows carloads no tap can produce. It used to: a rider fifteen miles
 * out appeared in somebody's car, and the Sarthi who tapped was told nobody was waiting.
 *
 * Both the distance function and the bound are imported from `carload.ts`, the same ones
 * dispatch enforces with. Dispatch kept private copies of both until this was written —
 * with a different earth radius — and a preview measuring a fence differently from the
 * code enforcing it is the whole failure mode this file exists to avoid.
 *
 * A car with `from: null` has no Sarthi yet, so there is no home to measure from and NO
 * FENCE IS APPLIED to it. That is the honest reading of an unclaimed vehicle, and the
 * caller is told which cars those were so it can say so.
 *
 * ── SPLITS ARE SIMULATED FAITHFULLY ─────────────────────────────────────────────────
 *
 * When a party is too large for any vehicle, `fillBySeats` takes what fits and dispatch
 * writes the rest back as a remainder request. This does the same in memory: the leftover
 * seats stay in the pool marked `isRemainder`, so they get remainder priority in the next
 * round exactly as they would in reality. Dropping them instead would show a family of
 * six as fully served by one four-seater.
 */

import { orderForCarload, milesBetween, GEO_FENCE_MILES, Waiting } from './carload';
import { fillBySeats, remaindersFirst, SkipReason } from './seats';

/** A waiting request, as this simulation needs it. */
export interface PreviewRider extends Waiting {
    seats: number;
    /** Rider opted out of travelling in separate cars. Defaults to allowed. */
    allowSplit?: boolean;
}

/**
 * One car to simulate: a Sarthi and the vehicle they hold.
 *
 * `from` is the SARTHI'S HOME, not the vehicle's anything — the fence bounds the
 * volunteer's journey. Null when no Sarthi has taken this car yet, which means no fence
 * can be applied to it and the caller has to say so rather than imply a limit was checked.
 */
export interface PreviewCar {
    /** Driver id when a Sarthi holds it, vehicle id when nobody does. For labelling. */
    id: string;
    /** Free passenger seats — capacity minus the driver. */
    seats: number;
    from: { lat: number; lng: number } | null;
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
     * Whose car this is — the `id` of the `PreviewCar` it came from.
     *
     * A Sarthi's id when one holds the vehicle, so the board can name them instead of
     * saying "Car 2". That is the difference between a grouping a manager can act on and
     * one they have to interpret.
     */
    carId: string;
    /**
     * Was a geo-fence applied to this car?
     *
     * False for an unclaimed vehicle, where there is no Sarthi and so no home to measure
     * from. Published because "these three, within fifteen miles of Ramesh" and "these
     * three, limit not checked" are different claims and the screen must not make the
     * stronger one by accident.
     */
    fenced: boolean;
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

/**
 * Why a rider is in no car.
 *
 * `outside-every-fence` is the one this file added, and it is the answer to a real
 * question a manager has been unable to ask: a rider far enough out that NO Sarthi on
 * shift may be sent to them. Before the fence was applied here they simply appeared in
 * somebody's car, and the Sarthi who tapped was told nobody was waiting — the rider sat
 * outside all evening with nothing on any screen explaining it. It needs a manager to
 * arrange something other than a normal pickup, so it has to be distinguishable.
 */
export type PreviewLeftoverReason =
    | SkipReason
    | 'no-car-left'
    | 'outside-every-fence';

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
    leftover: Array<{ id: string; seats: number; reason: PreviewLeftoverReason }>;
}

/**
 * Split the waiting pool into carloads, one per seat count given.
 *
 * @param pool       Every request eligible for this hall and direction. Already
 *                   filtered by the caller with the same predicate dispatch uses.
 * @param venue      This hall's venue — what "farthest" is measured from.
 * @param cars       The cars to simulate, in the order they are assumed to tap. Each
 *                   carries its seats and the Sarthi's home for the fence. Empty means
 *                   no cars, so everybody is leftover.
 * @param maxFleetSeats Largest passenger capacity in the fleet, deciding "wait for a
 *                   bigger car" versus "split". Passed through to `fillBySeats`.
 */
export function previewCarloads(
    pool: readonly PreviewRider[],
    venue: { lat: number; lng: number },
    cars: readonly PreviewCar[],
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

    /**
     * Riders at least one car was allowed to consider.
     *
     * Anyone never in here was outside EVERY fence — nobody on shift may be sent to
     * them, which is a different problem from "the cars filled up" and needs a different
     * answer from a manager.
     */
    const everEligible = new Set<string>();

    for (const car of cars) {
        if (remaining.length === 0) break;

        // THE FENCE, from the Sarthi's own home and with the same function and bound
        // dispatch enforces. A car nobody has taken yet has no home to measure from, so
        // no fence applies to it — and `fenced: false` below says so rather than letting
        // the group imply a limit was checked.
        const eligible = car.from
            ? remaining.filter(r =>
                milesBetween(car.from!.lat, car.from!.lng, r.lat, r.lng) <= GEO_FENCE_MILES)
            : remaining;
        for (const r of eligible) everEligible.add(r.id);
        if (eligible.length === 0) continue;

        // The same three calls, in the same order, as globalAssignDriver step 5–7b.
        const ordered = remaindersFirst(orderForCarload(eligible, venue, now));
        const { taken } = fillBySeats(
            ordered.map(r => ({
                id: r.id,
                seats: r.seats,
                allowSplit: r.allowSplit,
                isRemainder: r.isRemainder,
            })),
            car.seats,
            maxFleetSeats,
        );

        if (taken.length === 0) {
            // This car can take nobody — every remaining request is larger than it and
            // a bigger vehicle exists. Skipping to the next car is right; stopping here
            // would hide the riders a later, bigger car would reach.
            continue;
        }

        groups.push({
            seats: car.seats,
            carId: car.id,
            fenced: car.from !== null,
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
        const lastSeats = cars.length > 0 ? cars[cars.length - 1].seats : 0;
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
                /**
                 * OUT OF FENCE BEATS EVERY OTHER REASON, because it is the only one that
                 * says nobody on shift MAY be sent. A rider fifteen miles out is not
                 * waiting for a seat — there is no volunteer this evening who is allowed
                 * to collect them, and "no car free" would have a manager waiting for a
                 * Sarthi to finish a run that will never help.
                 *
                 * Checked first for that reason: the seat-fill below would happily
                 * describe them as skipped for seats, which is true of a car they were
                 * never eligible for.
                 */
                reason: !everEligible.has(r.id) && cars.some(c => c.from !== null)
                    ? 'outside-every-fence'
                    // 'no-seats-left' from that last fill means "this car was already
                    // full", which for the queue as a whole is simply "no car left".
                    : reasonById.get(r.id) === 'no-seats-left' || !reasonById.has(r.id)
                        ? 'no-car-left'
                        : reasonById.get(r.id)!,
            });
        }
    }

    return { groups, leftover };
}
