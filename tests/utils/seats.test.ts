/**
 * The CLIENT copy of the seat helpers.
 *
 * It is a mirror of functions/src/constants/seats.ts — separate tsconfigs, no
 * shared path — and a mirror that drifts is worse than no mirror: the rider's
 * form would offer a number the server refuses, or the driver's screen would
 * show a passenger count that disagrees with the car the dispatcher filled.
 * These assert the same behaviour the server suite asserts.
 */

import { describe, it, expect } from 'vitest';
import {
    seatsOf, seatsOnRide, maxPassengerSeats,
    MIN_SEATS, MAX_SEATS, DEFAULT_SEATS,
} from '../../src/constants/seats';

describe('seat constants match the server copy', () => {
    it('holds the same bounds', () => {
        expect([MIN_SEATS, MAX_SEATS, DEFAULT_SEATS]).toEqual([1, 8, 1]);
    });
});

describe('seatsOf — absent means one', () => {
    it('defaults a ride with no seat count to one', () => {
        // Every ride written before seats existed. If this moved, the whole
        // historical queue would be mis-booked with no error anywhere.
        expect(seatsOf({})).toBe(1);
        expect(seatsOf(null)).toBe(1);
        expect(seatsOf({ seatsRequested: null })).toBe(1);
    });

    it('reads and clamps a real count', () => {
        expect(seatsOf({ seatsRequested: 4 })).toBe(4);
        expect(seatsOf({ seatsRequested: '3' })).toBe(3);
        expect(seatsOf({ seatsRequested: 0 })).toBe(1);
        expect(seatsOf({ seatsRequested: 2.7 })).toBe(2);
        expect(seatsOf({ seatsRequested: 999 })).toBe(8);
    });
});

describe('seatsOnRide — people carried, not rows', () => {
    it('sums the roster', () => {
        // The defect on four screens: `students.length` reported 1 for a car
        // carrying a family of four.
        expect(seatsOnRide({ students: [{ seats: 3 }, { seats: 1 }] })).toBe(4);
    });

    it('counts a roster entry with no seats as one person', () => {
        expect(seatsOnRide({ students: [{ id: 'a' }, { id: 'b' }] })).toBe(2);
    });

    it('falls back to peers plus the rider, as the old displays did', () => {
        // Preserved deliberately: rides assigned before rosters carried seats
        // must keep reading the way they always did.
        expect(seatsOnRide({ peers: [{ id: 'p1' }, { id: 'p2' }] })).toBe(3);
    });

    it('falls back to the ride\'s own seat count when there is no roster', () => {
        expect(seatsOnRide({ seatsRequested: 5 })).toBe(5);
    });

    it('reads one for a bare ride, matching pre-seat behaviour exactly', () => {
        expect(seatsOnRide({})).toBe(1);
        expect(seatsOnRide({ students: [] })).toBe(1);
        expect(seatsOnRide(null)).toBe(1);
    });
});

describe('maxPassengerSeats — the fleet threshold', () => {
    it('subtracts the driver from the largest vehicle', () => {
        // The measured fleet: two capacity-4 cars, so three passenger seats —
        // which is why any party of four or more has to travel in two cars.
        expect(maxPassengerSeats([4, 4])).toBe(3);
        expect(maxPassengerSeats([4, 7])).toBe(6);
    });

    it('returns zero for an empty or unreadable fleet, meaning "unknown"', () => {
        // fillBySeats treats zero as unknown and assumes the current car is the
        // largest, so oversized groups get split and travel rather than waiting
        // forever on a vehicle nobody can prove exists.
        expect(maxPassengerSeats([])).toBe(0);
        expect(maxPassengerSeats([undefined, 'big', null])).toBe(0);
    });
});
