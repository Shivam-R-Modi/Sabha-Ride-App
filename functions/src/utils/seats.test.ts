/**
 * Seat accounting.
 *
 * The bug these pin: a ride request WAS a seat. `slice(0, availableSeats)` over a
 * list of ride documents meant a family of four was booked one place and the
 * driver arrived with room for one.
 *
 * The measured fleet when this was written: two vehicles, both capacity 4 — three
 * passenger seats each. So "no vehicle can take this group whole" is not an exotic
 * case here, it is every group of four or more. The fixtures use those numbers.
 */

import { describe, it, expect } from 'vitest';
import { fillBySeats, remaindersFirst } from './seats';
import { seatsOf, DEFAULT_SEATS, MAX_SEATS } from '../constants/seats';

/** Passenger seats in the real fleet: capacity 4 minus the driver. */
const CAR = 3;
const FLEET_MAX = 3;

const req = (id: string, seats: number, extra: Record<string, unknown> = {}) =>
    ({ id, seats, ...extra });

describe('seatsOf — absent means one, and that IS the migration', () => {
    it('treats a ride with no seatsRequested as one seat', () => {
        // Every ride written before this release. If this ever returned 0 or NaN,
        // historical rides would silently stop being dispatched.
        expect(seatsOf({})).toBe(1);
        expect(seatsOf(undefined)).toBe(1);
        expect(seatsOf(null)).toBe(1);
        expect(seatsOf({ seatsRequested: null })).toBe(DEFAULT_SEATS);
    });

    it('reads a real count', () => {
        expect(seatsOf({ seatsRequested: 4 })).toBe(4);
    });

    it('tolerates a string, which is what a hand-edited console row gives', () => {
        expect(seatsOf({ seatsRequested: '3' })).toBe(3);
    });

    it('refuses nonsense rather than propagating it into capacity maths', () => {
        expect(seatsOf({ seatsRequested: 0 })).toBe(DEFAULT_SEATS);
        expect(seatsOf({ seatsRequested: -5 })).toBe(DEFAULT_SEATS);
        expect(seatsOf({ seatsRequested: 'lots' })).toBe(DEFAULT_SEATS);
        expect(seatsOf({ seatsRequested: 2.7 })).toBe(2);
        expect(seatsOf({ seatsRequested: 999 })).toBe(MAX_SEATS);
    });
});

describe('fillBySeats — a request costs its seats, not one', () => {
    it('takes a request that fits whole', () => {
        const { taken, seatsUsed } = fillBySeats([req('a', 3)], CAR, FLEET_MAX);

        expect(taken).toEqual([{ id: 'a', seats: 3, totalSeats: 3, split: false }]);
        expect(seatsUsed).toBe(3);
    });

    it('fills several small requests up to capacity', () => {
        const { taken, skipped } = fillBySeats(
            [req('a', 1), req('b', 2), req('c', 1)], CAR, FLEET_MAX);

        expect(taken.map(t => t.id)).toEqual(['a', 'b']);
        expect(skipped).toEqual([{ id: 'c', seats: 1, reason: 'no-seats-left' }]);
    });

    it('does NOT hand three seats to three separate two-person requests', () => {
        // The whole point. Before, three requests were three seats regardless of
        // how many people each one represented.
        const { taken, seatsUsed } = fillBySeats(
            [req('a', 2), req('b', 2), req('c', 2)], CAR, FLEET_MAX);

        expect(taken.map(t => t.id)).toEqual(['a']);
        expect(seatsUsed).toBe(2);
    });
});

describe('fillBySeats — pass it over if a bigger car could take them whole', () => {
    it('skips a group this car cannot hold when the fleet has a larger vehicle', () => {
        // A 7-seater (6 passenger seats) exists. Better to let the family travel
        // together in that than to break them up now.
        const { taken, skipped } = fillBySeats([req('big', 5)], CAR, 6);

        expect(taken).toEqual([]);
        expect(skipped).toEqual([{ id: 'big', seats: 5, reason: 'waiting-for-bigger-vehicle' }]);
    });

    it('keeps serving smaller requests queued behind a skipped group', () => {
        // A skipped group must not block the queue — otherwise one large family
        // stalls every rider behind them.
        const { taken } = fillBySeats([req('big', 5), req('small', 2)], CAR, 6);

        expect(taken.map(t => t.id)).toEqual(['small']);
    });
});

describe('fillBySeats — split when no vehicle could ever take them whole', () => {
    it('partially fills a group larger than the biggest vehicle', () => {
        // Six people, largest car seats three. Waiting for a bigger car means
        // waiting forever, so three travel now and three stay in the pool.
        const { taken, skipped } = fillBySeats([req('family', 6)], CAR, FLEET_MAX);

        expect(taken).toEqual([{ id: 'family', seats: 3, totalSeats: 6, split: true }]);
        expect(skipped).toEqual([]);
    });

    it('leaves no seats behind when it splits', () => {
        const { taken, seatsUsed } = fillBySeats([req('family', 6)], CAR, FLEET_MAX);

        expect(seatsUsed).toBe(CAR);
        expect(taken[0].seats).toBe(CAR);
    });

    it('fills the car first, then splits with whatever is left', () => {
        const { taken } = fillBySeats([req('solo', 1), req('family', 6)], CAR, FLEET_MAX);

        expect(taken).toEqual([
            { id: 'solo', seats: 1, totalSeats: 1, split: false },
            { id: 'family', seats: 2, totalSeats: 6, split: true },
        ]);
    });

    it('honours a rider who asked not to be split, and says why', () => {
        // They can never be served as things stand. Reporting that is the point:
        // silently skipping them every round is how a family waits all evening
        // for a car that was never coming.
        const { taken, skipped } = fillBySeats(
            [req('family', 6, { allowSplit: false })], CAR, FLEET_MAX);

        expect(taken).toEqual([]);
        expect(skipped).toEqual([
            { id: 'family', seats: 6, reason: 'too-large-to-keep-together' },
        ]);
    });

    it('still lets a keep-together group ride whole when it fits', () => {
        const { taken } = fillBySeats([req('pair', 2, { allowSplit: false })], CAR, FLEET_MAX);

        expect(taken).toEqual([{ id: 'pair', seats: 2, totalSeats: 2, split: false }]);
    });
});

describe('fillBySeats — degenerate inputs', () => {
    it('takes nobody when the car is full', () => {
        const { taken, skipped } = fillBySeats([req('a', 1)], 0, FLEET_MAX);

        expect(taken).toEqual([]);
        expect(skipped).toEqual([{ id: 'a', seats: 1, reason: 'no-seats-left' }]);
    });

    it('splits rather than waits when the fleet size is unknown', () => {
        // If the vehicles lookup fails, concluding "a bigger car exists" would
        // make every driver skip this group forever, waiting on a vehicle nobody
        // can prove is there. Assuming this car is the largest gets people moved.
        for (const unknown of [0, -1, NaN]) {
            const { taken } = fillBySeats([req('family', 6)], CAR, unknown as number);
            expect(taken).toEqual([{ id: 'family', seats: 3, totalSeats: 6, split: true }]);
        }
    });

    it('returns empty for an empty queue', () => {
        expect(fillBySeats([], CAR, FLEET_MAX))
            .toEqual({ taken: [], skipped: [], seatsUsed: 0 });
    });
});

describe('remaindersFirst — half-served groups must not go to the back', () => {
    it('offers the leftover of a split group before untouched requests', () => {
        // Otherwise beginning to serve a family pushes their remainder back into
        // distance competition, and they can end up waiting longer than a group
        // nobody ever touched.
        const ordered = remaindersFirst([
            { id: 'near' },
            { id: 'leftover', isRemainder: true },
            { id: 'far' },
        ]);

        expect(ordered.map(o => o.id)).toEqual(['leftover', 'near', 'far']);
    });

    it('preserves the incoming distance order within each band', () => {
        const ordered = remaindersFirst([
            { id: 'near' },
            { id: 'mid' },
            { id: 'leftover-a', isRemainder: true },
            { id: 'far' },
            { id: 'leftover-b', isRemainder: true },
        ]);

        expect(ordered.map(o => o.id))
            .toEqual(['leftover-a', 'leftover-b', 'near', 'mid', 'far']);
    });

    it('does not mutate the caller\'s array', () => {
        const input = [{ id: 'a' }, { id: 'b', isRemainder: true }];
        remaindersFirst(input);
        expect(input.map(i => i.id)).toEqual(['a', 'b']);
    });
});
