/**
 * Ticking a stop off by itself, and the two ways that goes wrong.
 *
 * A Sarthi collects three or four Bhulka in one run, driving with Google Maps —
 * not with this app in front of them. So the app gets one fresh fix each time
 * they glance back at it: where the car is *now*, with no history. Everything
 * here is best-effort display, which is exactly why it must not be able to lie
 * loudly.
 *
 * The two failures worth the most care:
 *
 *   1. **A vague fix ticking the wrong house.** "You are 40m from Bhulku B, give
 *      or take 300m" says nothing at all. Accept it and a Sarthi parked outside
 *      A's house watches B tick itself off, and B gets left standing outside.
 *      `judgeFix` already refuses this; the job here is not to route around it.
 *
 *   2. **Un-ticking.** The car drives away from every house it visits — that is
 *      what a run is. A stop that clears itself the moment the car moves on is
 *      worse than no automation, because it undoes the Sarthi's own manual tick.
 */

import { describe, it, expect } from 'vitest';
import { advanceVisits, hasReachedEnd, type ProgressWaypoint } from '../../src/utils/rideProgress';

/** The founding venue, 360 Huntington Ave — the end of a pickup run. */
const SABHA = { lat: 42.339925, lng: -71.088182 };
/** Two homes, ~1.1km apart, so neither can be mistaken for the other. */
const HOUSE_A = { lat: 42.350000, lng: -71.088182 };
const HOUSE_B = { lat: 42.360000, lng: -71.088182 };
/** Where the Sarthi set off from. */
const DRIVER_HOME = { lat: 42.370000, lng: -71.088182 };

/** ~50m north of a point: inside any sane stop radius. */
const outside = (p: { lat: number; lng: number }) => ({ ...p, lat: p.lat + 0.00045 });

/** A phone that knows where it is. */
const sharp = (p: { lat: number; lng: number }) => ({ ...p, accuracy: 15 });
/** A phone indoors on Wi-Fi positioning, guessing. */
const vague = (p: { lat: number; lng: number }) => ({ ...p, accuracy: 300 });

/** A pickup run: home → A → B → sabha. */
function pickupRoute(): ProgressWaypoint[] {
    return [
        { ...DRIVER_HOME, type: 'start', visited: false },
        { ...HOUSE_A, type: 'pickup', studentId: 'a', visited: false },
        { ...HOUSE_B, type: 'pickup', studentId: 'b', visited: false },
        { ...SABHA, type: 'end', visited: false },
    ];
}

/** The return leg: sabha → B → A → home. Same mechanism, different labels. */
function dropoffRoute(): ProgressWaypoint[] {
    return [
        { ...SABHA, type: 'start', visited: false },
        { ...HOUSE_B, type: 'dropoff', studentId: 'b', visited: false },
        { ...HOUSE_A, type: 'dropoff', studentId: 'a', visited: false },
        { ...DRIVER_HOME, type: 'end', visited: false },
    ];
}

describe('advanceVisits', () => {
    it('ticks the stop the car is actually at, and only that one', () => {
        const result = advanceVisits(pickupRoute(), sharp(outside(HOUSE_A)));

        expect(result.changed).toBe(true);
        expect(result.waypoints[1].visited).toBe(true);
        expect(result.waypoints[2].visited).toBe(false);
        expect(result.newlyVisitedStudentIds).toEqual(['a']);
    });

    it('refuses a fix too vague to tell one house from another', () => {
        // Standing right outside A's door, but the phone only knows it to ±300m.
        const result = advanceVisits(pickupRoute(), vague(HOUSE_A));

        expect(result.changed).toBe(false);
        expect(result.waypoints.every(wp => !wp.visited)).toBe(true);
        expect(result.newlyVisitedStudentIds).toEqual([]);
    });

    it('never un-ticks a stop the car has driven away from', () => {
        const collected = pickupRoute();
        collected[1].visited = true;

        // Now at B, a kilometre from A.
        const result = advanceVisits(collected, sharp(outside(HOUSE_B)));

        expect(result.waypoints[1].visited).toBe(true);
        expect(result.waypoints[2].visited).toBe(true);
        expect(result.newlyVisitedStudentIds).toEqual(['b']);
    });

    it('never un-ticks a stop the Sarthi ticked by hand', () => {
        // The commonest real case: B was not outside, so the Sarthi ticked A and
        // B and drove on. Passing B's house later must not undo that, and must
        // not re-report B as newly collected.
        const both = pickupRoute();
        both[1].visited = true;
        both[2].visited = true;

        const result = advanceVisits(both, sharp(outside(HOUSE_B)));

        expect(result.changed).toBe(false);
        expect(result.newlyVisitedStudentIds).toEqual([]);
        expect(result.waypoints[1].visited).toBe(true);
        expect(result.waypoints[2].visited).toBe(true);
    });

    it('reports a stop as newly visited exactly once', () => {
        const first = advanceVisits(pickupRoute(), sharp(outside(HOUSE_A)));
        expect(first.newlyVisitedStudentIds).toEqual(['a']);

        // Still sitting outside A's house while they find their shoes.
        const second = advanceVisits(first.waypoints, sharp(outside(HOUSE_A)));
        expect(second.changed).toBe(false);
        expect(second.newlyVisitedStudentIds).toEqual([]);
    });

    it('leaves start and end alone', () => {
        // Parked at home, about to set off. The start is not a stop, and neither
        // is the sabha — the venue is confirmed by the Sarthi, not by GPS.
        const atStart = advanceVisits(pickupRoute(), sharp(DRIVER_HOME));
        expect(atStart.changed).toBe(false);
        expect(atStart.waypoints[0].visited).toBe(false);

        const atEnd = advanceVisits(pickupRoute(), sharp(SABHA));
        expect(atEnd.changed).toBe(false);
        expect(atEnd.waypoints[3].visited).toBe(false);
    });

    it('works the same on the return leg', () => {
        const result = advanceVisits(dropoffRoute(), sharp(outside(HOUSE_B)));

        expect(result.changed).toBe(true);
        expect(result.waypoints[1].visited).toBe(true);
        expect(result.newlyVisitedStudentIds).toEqual(['b']);
    });

    it('does not touch the array it was given', () => {
        // The caller holds this array as React state and as the ride document.
        // Mutating it in place means a re-render that shows nothing changed.
        const route = pickupRoute();
        const before = JSON.stringify(route);

        const result = advanceVisits(route, sharp(outside(HOUSE_A)));

        expect(JSON.stringify(route)).toBe(before);
        expect(result.waypoints).not.toBe(route);
    });

    it('reports no change when the car is nowhere near a stop', () => {
        const result = advanceVisits(pickupRoute(), sharp(SABHA));

        expect(result.changed).toBe(false);
        expect(result.waypoints).toEqual(pickupRoute());
    });

    it('tolerates a stop with no rider attached to it', () => {
        // Older rides, and hand-built routes, do not always carry studentId.
        const route: ProgressWaypoint[] = [
            { ...DRIVER_HOME, type: 'start', visited: false },
            { ...HOUSE_A, type: 'pickup', visited: false },
            { ...SABHA, type: 'end', visited: false },
        ];

        const result = advanceVisits(route, sharp(outside(HOUSE_A)));

        expect(result.changed).toBe(true);
        expect(result.waypoints[1].visited).toBe(true);
        expect(result.newlyVisitedStudentIds).toEqual([]);
    });

    it('survives an empty route', () => {
        const result = advanceVisits([], sharp(HOUSE_A));

        expect(result.changed).toBe(false);
        expect(result.newlyVisitedStudentIds).toEqual([]);
    });
});

describe('hasReachedEnd', () => {
    it('is true when the car is at the end of the route', () => {
        expect(hasReachedEnd(pickupRoute(), sharp(SABHA))).toBe(true);
    });

    it('is false on the way there', () => {
        expect(hasReachedEnd(pickupRoute(), sharp(HOUSE_A))).toBe(false);
    });

    it('is false on a fix too vague to say', () => {
        // This is the one that would matter: a wrong "you have arrived" pops the
        // roster sheet over the Sarthi's screen while they are still driving.
        expect(hasReachedEnd(pickupRoute(), vague(SABHA))).toBe(false);
    });

    it('is false when the route has no end', () => {
        const noEnd: ProgressWaypoint[] = [
            { ...HOUSE_A, type: 'pickup', studentId: 'a', visited: false },
        ];

        expect(hasReachedEnd(noEnd, sharp(HOUSE_A))).toBe(false);
    });

    it("answers for the return leg too, where the end is the Sarthi's own home", () => {
        expect(hasReachedEnd(dropoffRoute(), sharp(DRIVER_HOME))).toBe(true);
        expect(hasReachedEnd(dropoffRoute(), sharp(SABHA))).toBe(false);
    });
});
