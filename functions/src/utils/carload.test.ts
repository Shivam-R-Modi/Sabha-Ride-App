/**
 * Seed and grow — which riders one car is offered, and in what order.
 *
 * This replaced K-means seeded on driver home locations. That design needs
 * drivers spread out so "the cluster nearest me" means something; every driver
 * in this congregation lives within about two miles of the venue, so all K seeds
 * were effectively one point and cluster ownership was a near-tie.
 *
 * The ordering IS the decision — `fillBySeats` walks it and stops when the car is
 * full — so these tests are about order, not about capacity. Nothing here knows
 * how many seats a car has, on purpose: capacity lives in one place.
 *
 * The production run these are modelled on, 2026-08-14:
 *
 *   Dido Re took his three NEAREST riders (0.56, 0.62, 0.67 mi) and the seats
 *   ran out. Rebo Fe — a party of four, and the farthest request — was 4th and
 *   was reached by neither driver. Nearest-first serves the easy riders and
 *   leaves the hard one for a car that never comes.
 */

import { describe, it, expect } from 'vitest';
import { orderForCarload, chooseSeed, milesBetween, WAIT_ESCALATION_MS } from './carload';

/** Roughly the real venue. */
const VENUE = { lat: 42.339925, lng: -71.088182 };

/** Real coordinates from the production test set, so the geometry is honest. */
const SOUTH_BOSTON = { lat: 42.3337, lng: -71.0435 };   // ~2.3 mi out
const FAR_SOUTH_BOSTON = { lat: 42.3339, lng: -71.0311 }; // ~2.9 mi — Rebo Fe
const CAMBRIDGE = { lat: 42.3600, lng: -71.1062 };       // ~1.7 mi
const BROOKLINE = { lat: 42.3455, lng: -71.1200 };       // ~1.7 mi

const rider = (id: string, at: { lat: number; lng: number }, extra: Record<string, unknown> = {}) =>
    ({ id, lat: at.lat, lng: at.lng, ...extra }) as any;

const NOW = Date.parse('2026-08-14T19:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('chooseSeed — the anchor the carload is built around', () => {
    it('picks the rider farthest from the venue', () => {
        const pool = [
            rider('near', CAMBRIDGE),
            rider('far', FAR_SOUTH_BOSTON),
            rider('mid', SOUTH_BOSTON),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('far');
    });

    it('returns null for an empty pool rather than throwing', () => {
        expect(chooseSeed([], VENUE, NOW)).toBeNull();
    });

    it('returns the only rider when there is one', () => {
        expect(chooseSeed([rider('solo', CAMBRIDGE)], VENUE, NOW)!.id).toBe('solo');
    });

    it('prefers a remainder over a farther fresh request', () => {
        // The rest of that family is already on the road. Leaving them behind is
        // the worst outcome available, and fillBySeats sorts remainders to the
        // front anyway — seeding elsewhere would only fight it.
        const pool = [
            rider('far-fresh', FAR_SOUTH_BOSTON),
            rider('near-remainder', CAMBRIDGE, { isRemainder: true }),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('near-remainder');
    });

    it('picks the farthest remainder when there are several', () => {
        const pool = [
            rider('r-near', CAMBRIDGE, { isRemainder: true }),
            rider('r-far', FAR_SOUTH_BOSTON, { isRemainder: true }),
            rider('fresh', SOUTH_BOSTON),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('r-far');
    });

    it('promotes a long-waiting rider ahead of a farther recent one', () => {
        // The starvation valve. Distance is the default; "nobody waits for ever"
        // is the constraint on it.
        const pool = [
            rider('far-recent', FAR_SOUTH_BOSTON, { createdAt: minsAgo(5) }),
            rider('near-stale', CAMBRIDGE, { createdAt: minsAgo(120) }),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('near-stale');
    });

    it('does not promote a rider still inside the threshold', () => {
        const pool = [
            rider('far-recent', FAR_SOUTH_BOSTON, { createdAt: minsAgo(5) }),
            rider('near-newish', CAMBRIDGE, { createdAt: minsAgo(30) }),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('far-recent');
    });

    it('keeps remainders above long-waiters', () => {
        const pool = [
            rider('stale', CAMBRIDGE, { createdAt: minsAgo(600) }),
            rider('remainder', BROOKLINE, { isRemainder: true, createdAt: minsAgo(1) }),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('remainder');
    });

    it('treats an undateable request as having no claim to priority', () => {
        // Unknown must not fabricate a long wait and jump the queue.
        const pool = [
            rider('far', FAR_SOUTH_BOSTON, { createdAt: minsAgo(1) }),
            rider('nodate', CAMBRIDGE),
            rider('baddate', BROOKLINE, { createdAt: 'last Tuesday' }),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('far');
    });

    it('ignores a future timestamp rather than treating it as ancient', () => {
        const pool = [
            rider('far', FAR_SOUTH_BOSTON, { createdAt: minsAgo(1) }),
            rider('future', CAMBRIDGE, { createdAt: new Date(NOW + 60_000).toISOString() }),
        ];

        expect(chooseSeed(pool, VENUE, NOW)!.id).toBe('far');
    });
});

describe('orderForCarload — grow outward from the seed', () => {
    it('puts the seed first', () => {
        const pool = [
            rider('near', CAMBRIDGE),
            rider('far', FAR_SOUTH_BOSTON),
        ];

        expect(orderForCarload(pool, VENUE, NOW)[0].id).toBe('far');
    });

    it('orders the rest by distance FROM THE SEED, not from the venue', () => {
        // The whole point of growing: the carload should be geographically tight
        // around its anchor, not a list of riders sorted by something else.
        const pool = [
            rider('seed', FAR_SOUTH_BOSTON),
            rider('beside-seed', SOUTH_BOSTON),
            rider('cambridge', CAMBRIDGE),
            rider('brookline', BROOKLINE),
        ];

        expect(orderForCarload(pool, VENUE, NOW).map(r => r.id))
            .toEqual(['seed', 'beside-seed', 'cambridge', 'brookline']);
    });

    it('reproduces the production case: the party of four is offered first', () => {
        // Dido's actual pool. Nearest-first gave the three singles the seats and
        // never reached Rebo. Seed-and-grow offers her first.
        const pool = [
            rider('joy', { lat: 42.3337, lng: -71.0435 }),
            rider('jow', { lat: 42.3340, lng: -71.0418 }),
            rider('pev', { lat: 42.3323, lng: -71.0421 }),
            rider('rebo', FAR_SOUTH_BOSTON),
        ];

        expect(orderForCarload(pool, VENUE, NOW)[0].id).toBe('rebo');
    });

    it('keeps every rider — ordering decides who is asked first, not who travels', () => {
        const pool = [
            rider('a', CAMBRIDGE), rider('b', BROOKLINE),
            rider('c', SOUTH_BOSTON), rider('d', FAR_SOUTH_BOSTON),
        ];

        expect(orderForCarload(pool, VENUE, NOW)).toHaveLength(4);
    });

    it('returns an empty list for an empty pool', () => {
        expect(orderForCarload([], VENUE, NOW)).toEqual([]);
    });

    it('preserves the caller\'s own fields', () => {
        // Dispatch passes rich request objects through this; losing name, seats
        // or rideRequestId here would break everything downstream.
        const pool = [rider('x', CAMBRIDGE, { name: 'Kin Oja', seats: 3, rideRequestId: 'ride_1' })];

        const [first] = orderForCarload(pool, VENUE, NOW);

        expect(first.name).toBe('Kin Oja');
        expect(first.seats).toBe(3);
        expect(first.rideRequestId).toBe('ride_1');
    });

    it('is stable for riders at the same address', () => {
        // Two riders at one house must not swap places between taps and produce
        // a different carload each time.
        const same = { lat: 42.3455, lng: -71.1200 };
        const pool = [rider('zoe', same), rider('adam', same), rider('seed', FAR_SOUTH_BOSTON)];

        const once = orderForCarload(pool, VENUE, NOW).map(r => r.id);
        const twice = orderForCarload([...pool].reverse(), VENUE, NOW).map(r => r.id);

        expect(once).toEqual(twice);
    });

    it('does not mutate the pool it was given', () => {
        const pool = [rider('a', CAMBRIDGE), rider('b', FAR_SOUTH_BOSTON)];
        const before = pool.map(r => r.id);

        orderForCarload(pool, VENUE, NOW);

        expect(pool.map(r => r.id)).toEqual(before);
    });
});

describe('milesBetween', () => {
    it('is zero for the same point', () => {
        expect(milesBetween(42.34, -71.09, 42.34, -71.09)).toBe(0);
    });

    it('matches a known distance', () => {
        // Venue to Rebo Fe, measured against the production data.
        expect(milesBetween(VENUE.lat, VENUE.lng, FAR_SOUTH_BOSTON.lat, FAR_SOUTH_BOSTON.lng))
            .toBeCloseTo(2.9, 0);
    });

    it('is symmetric', () => {
        const a = milesBetween(VENUE.lat, VENUE.lng, CAMBRIDGE.lat, CAMBRIDGE.lng);
        const b = milesBetween(CAMBRIDGE.lat, CAMBRIDGE.lng, VENUE.lat, VENUE.lng);
        expect(a).toBeCloseTo(b, 10);
    });
});

describe('WAIT_ESCALATION_MS', () => {
    it('is long enough not to reorder the whole queue', () => {
        // Requests open two days early. A rider who booked on Wednesday has not
        // been "waiting" in any sense that should outrank distance on Friday.
        expect(WAIT_ESCALATION_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
        expect(WAIT_ESCALATION_MS).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
    });
});
