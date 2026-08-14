"use strict";
/**
 * Which riders one car should take, and in what order.
 *
 * WHY THIS REPLACED K-MEANS
 * -------------------------
 * Dispatch used `kMeansWithDriverSeeds`: K-means over every waiting rider, with
 * each available driver's HOME as an initial centroid, and the tapping driver
 * taking whichever cluster came back under their id.
 *
 * That design assumes drivers are spread out, so that "the cluster nearest me"
 * is a meaningful share of the riders. **In this congregation every driver lives
 * within about two miles of the venue.** All K seeds are therefore effectively
 * one point, K-means drifts them onto the rider data, and which driver receives
 * which cluster is decided by a near-tie at initialisation. The property the
 * whole design exists to provide — a driver gets the riders nearest to them —
 * does not exist here.
 *
 * The geometry is the same in both directions, too. Outbound the drivers start
 * within two miles of the venue; on the return run they are all standing AT it.
 * Drivers start from effectively one point either way, so driver identity never
 * changes the cost of a carload. There is no "my cluster" to find.
 *
 * So the only question a tap needs to answer is: **what is the best single
 * carload from the riders still waiting?** That is what this file answers.
 *
 * SEED AND GROW
 * -------------
 * 1. Pick a seed rider.
 * 2. Order everyone else by distance FROM THE SEED, nearest first.
 * 3. Hand that ordering to `fillBySeats`, which is unchanged.
 *
 * The result is a geographically tight carload built around one anchor, rather
 * than a share of a clustering nobody can influence.
 *
 * WHY THE SEED IS THE FARTHEST RIDER
 * ----------------------------------
 * This is the one decision that matters, and it wins in both regimes.
 *
 * With spare capacity it only affects route quality: serving an outlier while
 * there is still room to pair them with neighbours is cheaper than serving them
 * alone in the last car. That is the standard savings-heuristic result.
 *
 * Without spare capacity it decides who waits. Nearest-first — which is what the
 * old ordering did — hands every car to the riders closest to it, so a rider far
 * from everyone is served last every single time. Measured in production on
 * 2026-08-14: both drivers took their three nearest riders and the farthest
 * request, a party of four, was reached by neither.
 *
 * It is also right for the RETURN run, for a reason worth stating plainly: the
 * far group has the longest drive, so sending them out first is what minimises
 * the time until the LAST rider is home. One rule, both directions, and it
 * optimises the thing that actually matters on a Friday night.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAIT_ESCALATION_MS = void 0;
exports.milesBetween = milesBetween;
exports.chooseSeed = chooseSeed;
exports.orderForCarload = orderForCarload;
/**
 * A rider waiting longer than this is promoted to seed priority.
 *
 * The fairness valve. Seeding purely on distance means a rider in a dense area
 * may never be chosen while nearer, tighter carloads keep forming around them.
 * Distance is the right default; "and nobody waits for ever" is the constraint
 * on it.
 *
 * Ninety minutes rather than ten: a rider who asked two days early has not been
 * "waiting" in any sense that matters until the window is actually open, and the
 * pickup window itself is only a few hours. This is meant to catch someone
 * repeatedly passed over during one evening, not to reorder the whole queue.
 */
exports.WAIT_ESCALATION_MS = 90 * 60 * 1000;
/** Great-circle miles. Same formula as the one in globalAssignDriver. */
function milesBetween(aLat, aLng, bLat, bLng) {
    const R = 3958.8;
    const p = Math.PI / 180;
    const dLat = (bLat - aLat) * p;
    const dLng = (bLng - aLng) * p;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
/** How long this request has been waiting, or 0 when it cannot be dated. */
function waitedMs(r, now) {
    if (typeof r.createdAt !== 'string')
        return 0;
    const t = Date.parse(r.createdAt);
    // An unparseable or future timestamp must not fabricate a long wait and
    // jump the queue. Unknown means "no claim to priority", not "top priority".
    return Number.isFinite(t) && t <= now ? now - t : 0;
}
/**
 * Choose the anchor this carload is built around.
 *
 * Priority order, highest first:
 *
 *   1. Remainders — the other half of a group already partly on the road. The
 *      rest of that family is travelling; leaving them behind is the worst
 *      outcome available, and `fillBySeats` already sorts remainders to the
 *      front, so seeding anywhere else would only fight it.
 *   2. Riders past the wait threshold — the starvation valve.
 *   3. Farthest from the venue.
 *
 * Within each tier the farthest rider wins, so the tiers narrow the field rather
 * than replacing the rule.
 */
function chooseSeed(pool, venue, now = Date.now(), escalationMs = exports.WAIT_ESCALATION_MS) {
    if (pool.length === 0)
        return null;
    const remainders = pool.filter(r => r.isRemainder);
    const escalated = pool.filter(r => waitedMs(r, now) >= escalationMs);
    const tier = remainders.length ? remainders
        : escalated.length ? escalated
            : pool;
    return tier.reduce((far, r) => milesBetween(r.lat, r.lng, venue.lat, venue.lng)
        > milesBetween(far.lat, far.lng, venue.lat, venue.lng) ? r : far);
}
/**
 * The waiting pool, ordered as one car should be offered it.
 *
 * The seed first, then everyone else by distance from the seed. `fillBySeats`
 * walks this in order and stops when the car is full, so the ordering IS the
 * decision — this function does not decide who travels, only who is asked first.
 *
 * Seats are not considered here on purpose. Whether a request fits, waits for a
 * bigger car, or must be split is `fillBySeats`'s job and it is already tested;
 * duplicating any of it here would give two places to disagree about capacity.
 */
function orderForCarload(pool, venue, now = Date.now(), escalationMs = exports.WAIT_ESCALATION_MS) {
    const seed = chooseSeed(pool, venue, now, escalationMs);
    if (!seed)
        return [];
    const rest = pool
        .filter(r => r.id !== seed.id)
        .map(r => ({ r, d: milesBetween(r.lat, r.lng, seed.lat, seed.lng) }))
        // Stable on ties so two riders at the same address cannot swap places
        // between taps and produce a different carload each time.
        .sort((a, b) => a.d - b.d || a.r.id.localeCompare(b.r.id))
        .map(x => x.r);
    return [seed, ...rest];
}
//# sourceMappingURL=carload.js.map