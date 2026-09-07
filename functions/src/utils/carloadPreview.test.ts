/**
 * The preview must agree with dispatch, and must not claim more than it knows.
 *
 * Those are the two failure modes worth testing. A preview that disagrees with
 * `globalAssignDriver` is worse than no preview — a manager plans around it, moves
 * somebody by hand, and the tap does something else. A preview that hides its
 * assumptions is the same defect wearing a confident label.
 *
 * The first block therefore pins the FIRST group against the real dispatch pipeline
 * called directly, and the rest pin the parts this file adds: successive cars, split
 * remainders carried forward, and a reason on every rider left behind.
 */

import { describe, it, expect } from 'vitest';
import { previewCarloads, PreviewRider, PreviewCar } from './carloadPreview';
import { orderForCarload } from './carload';
import { fillBySeats, remaindersFirst } from './seats';

/** The venue. Every distance below is measured from here. */
const VENUE = { lat: 42.339925, lng: -71.088182 };
const NOW = Date.parse('2026-09-04T22:00:00Z');

/**
 * A rider `miles` north of the venue.
 *
 * North so one degree of latitude is a clean ~69 miles regardless of longitude, which
 * keeps these fixtures readable — the distances are meant to be obvious at a glance.
 */
const at = (id: string, miles: number, over: Partial<PreviewRider> = {}): PreviewRider => ({
    id, lat: VENUE.lat + miles / 69, lng: VENUE.lng, seats: 1, ...over,
});

const idsOf = (g: { riders: Array<{ id: string }> }) => g.riders.map(r => r.id);

/**
 * A car with no Sarthi, so NO FENCE applies to it.
 *
 * The default for every case that is not about the fence — it keeps those fixtures
 * about what they were about. `driven()` below is the fenced one.
 */
let carNo = 0;
const car = (seats: number): PreviewCar => ({ id: `car-${++carNo}`, seats, from: null });

/** A car held by a Sarthi living `miles` north of the venue, so its fence is real. */
const driven = (id: string, seats: number, miles: number): PreviewCar => ({
    id, seats, from: { lat: VENUE.lat + miles / 69, lng: VENUE.lng },
});

describe('previewCarloads — the first group IS what dispatch would take', () => {
    const pool = [at('a', 1), at('b', 2), at('c', 8), at('d', 8.2), at('e', 3)];

    it('matches orderForCarload + remaindersFirst + fillBySeats run by hand', () => {
        // Not a re-implementation: the same three functions, in the same order, which is
        // the only thing that makes this test meaningful rather than circular. If the
        // preview ever grows its own geometry, this is what fails.
        const expected = fillBySeats(
            remaindersFirst(orderForCarload(pool, VENUE, NOW)).map(r => ({
                id: r.id, seats: r.seats, allowSplit: r.allowSplit, isRemainder: r.isRemainder,
            })),
            3,
            7,
        ).taken.map(t => t.id);

        const { groups } = previewCarloads(pool, VENUE, [car(3)], 7, NOW);

        expect(idsOf(groups[0])).toEqual(expected);
        expect(expected.length).toBeGreaterThan(0);   // the comparison is not vacuous
    });

    it('anchors on the rider FARTHEST from the venue', () => {
        // The one decision carload.ts says matters. `d` is farthest, so it seeds, and
        // `c` — 0.2 miles from it — comes with it rather than the riders nearer the hall.
        const { groups } = previewCarloads(pool, VENUE, [car(3)], 7, NOW);

        expect(groups[0].anchorId).toBe('d');
        expect(idsOf(groups[0])).toContain('c');
        expect(idsOf(groups[0])).not.toContain('a');
    });

    it('reports the seat count it assumed, on every group', () => {
        // The whole of this function's honesty. Without it a row implies the grouping
        // is absolute, when a different car tapping first re-forms it.
        const { groups } = previewCarloads(pool, VENUE, [car(3), car(2)], 7, NOW);
        expect(groups.map(g => g.seats)).toEqual([3, 2]);
    });
});

describe('previewCarloads — successive cars', () => {
    const pool = [at('a', 1), at('b', 1.1), at('c', 9), at('d', 9.1)];

    it('never puts one rider in two cars', () => {
        // The invariant. Everything else here is presentation; this one is correctness.
        const { groups } = previewCarloads(pool, VENUE, [car(2), car(2)], 7, NOW);
        const all = groups.flatMap(idsOf);

        expect(new Set(all).size).toBe(all.length);
    });

    it('gives the far pair the FIRST car and the near pair the second', () => {
        const { groups } = previewCarloads(pool, VENUE, [car(2), car(2)], 7, NOW);

        expect(idsOf(groups[0]).sort()).toEqual(['c', 'd']);
        expect(idsOf(groups[1]).sort()).toEqual(['a', 'b']);
    });

    it('stops once nobody is left, rather than emitting empty cars', () => {
        // An empty group would render as a car with nobody in it, which reads as a
        // fault. Four riders, four cars offered, two cars used.
        const { groups } = previewCarloads(pool, VENUE, [car(2), car(2), car(2), car(2)], 7, NOW);
        expect(groups).toHaveLength(2);
    });

    it('leaves everybody over when there are no cars at all', () => {
        const { groups, leftover } = previewCarloads(pool, VENUE, [], 7, NOW);

        expect(groups).toEqual([]);
        expect(leftover.map(l => l.id).sort()).toEqual(['a', 'b', 'c', 'd']);
        /**
         * AND THE REASON IS "no car free", not "outside every fence".
         *
         * With no cars nobody was measured against anything, so a distance claim is one
         * this cannot make — it would send a manager looking at where people live when
         * the answer is that no vehicle is free. Asserted because ids alone let a
         * mutation swap every reason without failing anything.
         */
        expect(leftover.every(l => l.reason === 'no-car-left')).toBe(true);
    });

    it('SKIPS a car that can take nobody instead of ending the walk', () => {
        // One party of four, a two-seater and then a six-seater. The two-seater takes
        // nobody — a bigger vehicle exists, so `fillBySeats` waits rather than splits —
        // and stopping there would hide a group the six-seater serves.
        const family = [at('fam', 5, { seats: 4 })];
        const { groups } = previewCarloads(family, VENUE, [car(2), car(6)], 6, NOW);

        expect(groups).toHaveLength(1);
        expect(groups[0].seats).toBe(6);
        expect(idsOf(groups[0])).toEqual(['fam']);
    });
});

describe('previewCarloads — a party too large for any vehicle', () => {
    // Six people, biggest car in the fleet seats three. `fillBySeats` splits rather
    // than stranding them, and dispatch writes the leftover back as its own request.
    const huge = [at('big', 5, { seats: 6 })];

    it('carries the leftover half into the NEXT car', () => {
        // Dropping it instead would show a family of six as fully served by a
        // three-seater — the flattering version of the answer, and wrong.
        const { groups } = previewCarloads(huge, VENUE, [car(3), car(3)], 3, NOW);

        expect(groups).toHaveLength(2);
        expect(groups[0].riders[0]).toMatchObject({ seats: 3, totalSeats: 6, split: true });
        expect(idsOf(groups[1])).toEqual(['big']);
    });

    it('shows the remainder as still waiting when there is only one car', () => {
        const { groups, leftover } = previewCarloads(huge, VENUE, [car(3)], 3, NOW);

        expect(groups[0].riders[0].split).toBe(true);
        // Three of the six travel; three are still waiting, and the seats say so.
        expect(leftover).toEqual([{ id: 'big', seats: 3, reason: 'no-car-left' }]);
    });

    it('says NOTHING CAN CARRY THEM when the rider refused to be split', () => {
        /**
         * The reason that cannot resolve itself. No vehicle seats this many and the
         * rider asked not to travel separately, so every driver skips them every round,
         * for ever, and a bare count in the queue looks exactly like somebody who has
         * merely not been collected yet. It needs a bigger vehicle registered or the
         * rider's consent — both manager actions, neither of which happens if the screen
         * does not say so.
         */
        const stuck = [at('stuck', 5, { seats: 6, allowSplit: false })];
        const { groups, leftover } = previewCarloads(stuck, VENUE, [car(3), car(3)], 3, NOW);

        expect(groups).toEqual([]);
        expect(leftover).toEqual([
            { id: 'stuck', seats: 6, reason: 'too-large-to-keep-together' },
        ]);
    });

    it('says WAITING FOR A BIGGER CAR when one exists in the fleet', () => {
        // A different action entirely: nothing is broken, the right vehicle is simply
        // not free tonight.
        const four = [at('four', 5, { seats: 4 })];
        const { groups, leftover } = previewCarloads(four, VENUE, [car(2)], 6, NOW);

        expect(groups).toEqual([]);
        expect(leftover).toEqual([
            { id: 'four', seats: 4, reason: 'waiting-for-bigger-vehicle' },
        ]);
    });
});

describe('previewCarloads — remainders and long waits', () => {
    it('anchors on a REMAINDER over a farther untouched rider', () => {
        // The rest of that family is already on the road. `chooseSeed` puts them first,
        // and the preview has to show that or a manager reads the queue as though the
        // farthest rider goes next.
        const pool = [
            at('far', 10),
            at('left-behind', 2, { isRemainder: true, seats: 1 }),
        ];
        const { groups } = previewCarloads(pool, VENUE, [car(1)], 7, NOW);

        expect(groups[0].anchorId).toBe('left-behind');
    });

    it('anchors on somebody past the wait threshold over a farther rider', () => {
        // The starvation valve, and it is time-dependent — so `now` is passed in rather
        // than read from the clock, which is also what makes this assertable.
        const pool = [
            at('far', 10, { createdAt: new Date(NOW - 60_000).toISOString() }),
            at('patient', 2, { createdAt: new Date(NOW - 3 * 3600_000).toISOString() }),
        ];
        const { groups } = previewCarloads(pool, VENUE, [car(1)], 7, NOW);

        expect(groups[0].anchorId).toBe('patient');
    });
});

describe('previewCarloads — a rider the map cannot place', () => {
    it('reports them instead of dropping them from the screen', () => {
        /**
         * An address that never geocoded. Dispatch cannot place them either, so they are
         * genuinely not in a car — but vanishing from the manager's queue is how a
         * person waits all evening with nothing anywhere saying why. It is a fixable
         * thing, and only fixable if visible.
         */
        const pool: PreviewRider[] = [
            at('ok', 3),
            { id: 'nowhere', lat: NaN, lng: NaN, seats: 2 },
        ];
        const { groups, leftover } = previewCarloads(pool, VENUE, [car(4)], 7, NOW);

        expect(idsOf(groups[0])).toEqual(['ok']);
        expect(leftover).toEqual([{ id: 'nowhere', seats: 2, reason: 'no-car-left' }]);
    });

    it('does not let one unplaceable rider poison the geometry', () => {
        // NaN in a distance comparison makes every `>` false, so an unfiltered pool can
        // silently hand the anchor to whoever happens to be first in the array.
        const pool: PreviewRider[] = [
            { id: 'nowhere', lat: NaN, lng: NaN, seats: 1 },
            at('near', 1),
            at('far', 9),
        ];
        const { groups } = previewCarloads(pool, VENUE, [car(2)], 7, NOW);

        expect(groups[0].anchorId).toBe('far');
    });
});

describe('previewCarloads — every rider is accounted for', () => {
    it('puts each rider in exactly one car or one leftover row', () => {
        /**
         * The property a manager actually relies on: the queue adds up. A rider who is
         * in neither list has disappeared from the only screen that would show them
         * waiting, which is this codebase's recurring defect — a query that returns an
         * empty list instead of erroring.
         *
         * Split riders are the interesting case: they appear in a car AND in the
         * leftover, because part of them travels and part does not.
         */
        const pool = [
            at('a', 1), at('b', 2, { seats: 2 }), at('c', 9),
            at('d', 9.1, { seats: 3 }), at('e', 12, { seats: 5 }),
            { id: 'nowhere', lat: NaN, lng: NaN, seats: 1 } as PreviewRider,
        ];
        const { groups, leftover } = previewCarloads(pool, VENUE, [car(3), car(3)], 4, NOW);

        const seen = new Set([...groups.flatMap(idsOf), ...leftover.map(l => l.id)]);
        expect([...seen].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'nowhere']);
    });
});

describe('previewCarloads — the anchor label is never wrong', () => {
    it('reports NO anchor when the seed could not fit in the car', () => {
        /**
         * The seed can be skipped: too large for this car while a bigger one exists in
         * the fleet. The ordering still grew outward from where they live, so
         * geometrically they are still the anchor — but "anchored on Ramesh" printed
         * above a list containing no Ramesh reads as a bug, and a manager would chase
         * it. Null gives the caller nothing to render rather than something false.
         */
        const pool = [
            at('far-family', 9, { seats: 4 }),
            at('near-a', 1),
            at('near-b', 1.1),
        ];
        // Two seats here, six in the fleet — so the family waits for the bigger car
        // rather than being split, and the near pair travel.
        const { groups, leftover } = previewCarloads(pool, VENUE, [car(2)], 6, NOW);

        expect(idsOf(groups[0]).sort()).toEqual(['near-a', 'near-b']);
        expect(groups[0].anchorId).toBeNull();
        expect(leftover).toEqual([
            { id: 'far-family', seats: 4, reason: 'waiting-for-bigger-vehicle' },
        ]);
    });

    it('still names the anchor when they did travel', () => {
        const pool = [at('far', 9), at('near', 1)];
        const { groups } = previewCarloads(pool, VENUE, [car(2)], 6, NOW);

        expect(groups[0].anchorId).toBe('far');
    });
});

describe('previewCarloads — a split leftover keeps its priority', () => {
    /** A rider `miles` SOUTH of the venue, so they can be far from a northern seed too. */
    const south = (id: string, miles: number, over: Partial<PreviewRider> = {}): PreviewRider =>
        ({ id, lat: VENUE.lat - miles / 69, lng: VENUE.lng, seats: 1, ...over });

    it('anchors the next car on the leftover, not on a farther untouched rider', () => {
        /**
         * The fairness rule `remaindersFirst` and `chooseSeed`'s remainder tier exist
         * for, carried through the simulation. Half a party of six is already in car
         * one; without marking the leftover as a remainder it drops back into DISTANCE
         * competition, and a farther untouched rider takes car two — so beginning to
         * serve a family makes them wait longer than one nobody ever touched, and the
         * preview would show a manager that happening as though it were correct.
         *
         * The fixture has to be built to isolate that. The remainder must end up NEARER
         * the venue than a rider who survived car one, or the remainder wins on distance
         * anyway and the flag proves nothing — which is how the first version of this
         * test passed for the wrong reason. Hence one seed far to the NORTH and an
         * untouched rider far to the SOUTH: 21 miles apart, so car one cannot reach both.
         */
        const pool = [
            at('family', 2, { seats: 6 }),   // near the venue, too big for any vehicle
            at('far-north', 11),             // farthest from the venue, so it seeds
            south('far-south', 10),          // far from the venue AND from the seed
        ];
        // Three seats a car, three the largest in the fleet — so the family is split
        // rather than left waiting for a vehicle that does not exist.
        const { groups } = previewCarloads(pool, VENUE, [car(3), car(3)], 3, NOW);

        // Car one: the northern seed, then the family's first two seats. The southern
        // rider is 21 miles from the seed and does not fit.
        expect(groups[0].anchorId).toBe('far-north');
        expect(idsOf(groups[0])).toEqual(['far-north', 'family']);
        expect(groups[0].riders[1]).toMatchObject({ split: true, totalSeats: 6 });

        // Car two: the leftover, though `far-south` is four times farther from the
        // venue. That is the flag doing its job.
        expect(groups[1].anchorId).toBe('family');
        expect(idsOf(groups[1])).toContain('family');
    });
});

/**
 * THE GEO-FENCE, which is what makes this a preview rather than a guess.
 *
 * `globalAssignDriver` will not send a volunteer more than GEO_FENCE_MILES from their own
 * HOME — not from the venue — and that bound decides who is even eligible for a given
 * Sarthi. Without it the board showed carloads no tap could produce: a rider fifteen
 * miles out appeared in somebody's car, and the Sarthi who tapped was told nobody was
 * waiting. The rider sat outside all evening with nothing on any screen explaining it.
 *
 * The distance function and the bound are both imported from carload.ts, the same ones
 * dispatch enforces with — so these tests are about the fence being APPLIED, not about
 * arithmetic that lives elsewhere.
 */
describe('previewCarloads — the geo-fence', () => {
    it('will not offer a Sarthi a rider beyond the fence', () => {
        // The Sarthi is at the venue; the rider is 20 miles out. Dispatch would refuse,
        // so the preview must too.
        const pool = [at('far', 20)];
        const { groups } = previewCarloads(pool, VENUE, [driven('sarthi', 4, 0)], 7, NOW);

        expect(groups).toEqual([]);
    });

    it('offers a rider just INSIDE the fence', () => {
        const pool = [at('ok', 14)];
        const { groups } = previewCarloads(pool, VENUE, [driven('sarthi', 4, 0)], 7, NOW);

        expect(idsOf(groups[0])).toEqual(['ok']);
    });

    it('measures from the SARTHI, not from the venue', () => {
        /**
         * The whole point, and the thing a fence-from-the-venue implementation gets
         * wrong. This Sarthi lives 14 miles north, so a rider 25 miles north is 11 miles
         * from THEM and perfectly reachable — while a rider at the venue itself is 14
         * miles away and also reachable. Measured from the venue, the 25-mile rider
         * would be refused.
         */
        const pool = [at('further-north', 25)];
        const { groups } = previewCarloads(pool, VENUE, [driven('northern', 4, 14)], 7, NOW);

        expect(idsOf(groups[0])).toEqual(['further-north']);
    });

    it('SAYS OUTSIDE-EVERY-FENCE for a rider no Sarthi may be sent to', () => {
        /**
         * The Woburn case, and the reason this reason exists. "No car free" would have a
         * manager waiting for a Sarthi to finish a run that will never help — there is
         * no volunteer this evening who is ALLOWED to collect them. It needs a different
         * arrangement, so it has to be distinguishable.
         */
        const pool = [at('woburn', 20), at('near', 2)];
        const { groups, leftover } = previewCarloads(
            pool, VENUE, [driven('sarthi', 4, 0)], 7, NOW,
        );

        expect(idsOf(groups[0])).toEqual(['near']);
        expect(leftover).toEqual([
            { id: 'woburn', seats: 1, reason: 'outside-every-fence' },
        ]);
    });

    it('does not say that when ONE Sarthi can reach them', () => {
        // Out of range for the first car, in range for the second. The reason has to be
        // about every Sarthi, not about the last one checked.
        const pool = [at('far-north', 25)];
        const { groups } = previewCarloads(
            pool, VENUE, [driven('a', 4, 0), driven('b', 4, 14)], 7, NOW,
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].carId).toBe('b');
    });

    it('says NO CAR LEFT, not out of fence, for a reachable rider who missed out', () => {
        // Within the fence and simply not picked up — the seats ran out. Conflating the
        // two would send a manager looking for a transport problem that is not there.
        const pool = [at('a', 1), at('b', 2), at('c', 3)];
        const { leftover } = previewCarloads(pool, VENUE, [driven('sarthi', 1, 0)], 7, NOW);

        expect(leftover.every(l => l.reason === 'no-car-left')).toBe(true);
        expect(leftover).toHaveLength(2);
    });

    it('applies NO FENCE to a car nobody has taken yet', () => {
        // No Sarthi means no home to measure from. Refusing everybody would be worse
        // than admitting the limit was not checked, and `fenced` is what admits it.
        const pool = [at('far', 40)];
        const { groups } = previewCarloads(pool, VENUE, [car(4)], 7, NOW);

        expect(idsOf(groups[0])).toEqual(['far']);
        expect(groups[0].fenced).toBe(false);
    });

    it('marks a fenced group as fenced', () => {
        const { groups } = previewCarloads([at('a', 1)], VENUE, [driven('s', 4, 0)], 7, NOW);
        expect(groups[0].fenced).toBe(true);
    });

    it('does not blame DISTANCE for a rider whose address never geocoded', () => {
        /**
         * Two different problems with two different fixes. "Too far for every Sarthi"
         * has a manager looking at where somebody lives; the real answer is that the
         * address never geocoded and needs correcting. Worth pinning even though the
         * shape of the code makes it true today — the no-coordinate riders are put
         * straight into the leftovers and never reach the fence classification, and
         * nothing but this says they should stay there.
         */
        const pool: PreviewRider[] = [
            at('near', 1),
            { id: 'nowhere', lat: NaN, lng: NaN, seats: 1 },
        ];
        const { leftover } = previewCarloads(pool, VENUE, [driven('s', 4, 0)], 7, NOW);

        expect(leftover).toEqual([{ id: 'nowhere', seats: 1, reason: 'no-car-left' }]);
    });

    it('does NOT claim out-of-fence when an unfenced car was in play', () => {
        /**
         * A rider out of range of every Sarthi, but an unclaimed car is also being
         * simulated — and no fence applied to that one. So "no Sarthi may be sent to
         * them" is not a claim this can make, and the softer reason is the honest one.
         */
        const pool = [at('far', 40), at('near', 1)];
        const { leftover } = previewCarloads(
            pool, VENUE, [driven('s', 1, 0), car(1)], 7, NOW,
        );

        expect(leftover.map(l => l.reason)).not.toContain('outside-every-fence');
    });

    it('names WHOSE car each group is', () => {
        // A Sarthi's id rather than "Car 2" — the difference between a grouping a
        // manager can act on and one they have to interpret.
        const pool = [at('a', 1), at('b', 2)];
        const { groups } = previewCarloads(
            pool, VENUE, [driven('ramesh', 1, 0), driven('nisha', 1, 0)], 7, NOW,
        );

        expect(groups.map(g => g.carId)).toEqual(['ramesh', 'nisha']);
    });

    it('SKIPS a Sarthi who can reach nobody without ending the walk', () => {
        // One Sarthi far out of range of everybody, another local. Stopping at the first
        // would hide the carload the second forms.
        const pool = [at('near', 1)];
        const { groups } = previewCarloads(
            pool, VENUE, [driven('remote', 4, 60), driven('local', 4, 0)], 7, NOW,
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].carId).toBe('local');
    });

    it('leaves everybody over when every Sarthi is out of range', () => {
        const pool = [at('a', 1), at('b', 2)];
        const { groups, leftover } = previewCarloads(
            pool, VENUE, [driven('remote', 4, 60)], 7, NOW,
        );

        expect(groups).toEqual([]);
        expect(leftover.map(l => l.reason)).toEqual(
            ['outside-every-fence', 'outside-every-fence'],
        );
    });
});
