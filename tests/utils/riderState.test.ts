/**
 * The rider home screen's state machine.
 *
 * Most of these are priority tests — two things are true at once and only one
 * card may show. That ordering used to be implicit in where an early return
 * happened to sit in the render, which is not a place anyone can review.
 */

import { describe, it, expect } from 'vitest';
import { deriveRiderState, splitInfo, type RiderInputs } from '../../src/utils/riderState';

const base: RiderInputs = {
    loading: false,
    hasEvent: true,
    dropoffOpen: false,
    activeRide: null,
    activeRides: [],
    hasResponded: true,
    attendanceResponse: 'yes',
    dismissedRequest: null,
};

const state = (over: Partial<RiderInputs> = {}) => deriveRiderState({ ...base, ...over });

describe('deriveRiderState — the ordinary path', () => {
    it('offers a ride to someone who is coming and has not booked', () => {
        expect(state()).toEqual({ kind: 'can-request' });
    });

    it('shows waiting once they have requested', () => {
        expect(state({ activeRide: { status: 'requested' } }))
            .toEqual({ kind: 'waiting-for-driver' });
    });

    it('shows the driver once one is assigned', () => {
        expect(state({ activeRide: { status: 'assigned' } }))
            .toEqual({ kind: 'driver-assigned', split: null });
    });

    it.each(['driver_en_route', 'arriving', 'in_progress'])(
        'still shows the driver while %s', (status) => {
            expect(state({ activeRide: { status } }).kind).toBe('driver-assigned');
        });
});

describe('deriveRiderState — never guess', () => {
    it('shows a skeleton while loading, not an empty state', () => {
        // An empty state shown early reads as "you have no ride", which is the
        // most alarming possible lie.
        expect(state({ loading: true }).kind).toBe('loading');
    });

    it('loading outranks everything, including a live ride', () => {
        expect(state({ loading: true, activeRide: { status: 'assigned' } }).kind)
            .toBe('loading');
    });

    it('says plainly when no sabha is scheduled', () => {
        expect(state({ hasEvent: false }).kind).toBe('no-sabha');
    });

    it('no sabha outranks the attendance question, which would be about nothing', () => {
        expect(state({ hasEvent: false, hasResponded: false }).kind).toBe('no-sabha');
    });
});

describe('deriveRiderState — attendance', () => {
    it('asks before offering a ride', () => {
        expect(state({ hasResponded: false }).kind).toBe('attendance-unanswered');
    });

    it('does not offer a ride to someone who said they are not coming', () => {
        expect(state({ attendanceResponse: 'no' }).kind).toBe('not-coming');
    });

    it('a live ride outranks the attendance question', () => {
        // Someone who has booked has self-evidently answered, whatever the
        // attendance document says.
        expect(state({ hasResponded: false, activeRide: { status: 'assigned' } }).kind)
            .toBe('driver-assigned');
    });

    it('a live ride outranks even an explicit "not coming"', () => {
        expect(state({ attendanceResponse: 'no', activeRide: { status: 'requested' } }).kind)
            .toBe('waiting-for-driver');
    });
});

describe('deriveRiderState — a dismissed request', () => {
    const dismissed = { managerName: 'Ramesh', managerContact: '+15550001111' };

    it('is surfaced, because nothing else would tell them', () => {
        expect(state({ dismissedRequest: dismissed }))
            .toEqual({ kind: 'dismissed', info: dismissed });
    });

    it('outranks the attendance question — it needs acting on tonight', () => {
        expect(state({ dismissedRequest: dismissed, hasResponded: false }).kind)
            .toBe('dismissed');
    });

    it('is dropped once they have a ride again', () => {
        expect(state({ dismissedRequest: dismissed, activeRide: { status: 'assigned' } }).kind)
            .toBe('driver-assigned');
    });
});

describe('deriveRiderState — going home', () => {
    it('offers the way home once drop-off opens', () => {
        expect(state({ dropoffOpen: true }).kind).toBe('ready-to-leave');
    });

    it('confirms once they have asked', () => {
        expect(state({ dropoffOpen: true, activeRide: { dropoffRequested: true } }).kind)
            .toBe('in-dropoff-queue');
    });

    it('outranks the attendance question — being here answers it', () => {
        expect(state({ dropoffOpen: true, hasResponded: false }).kind).toBe('ready-to-leave');
    });

    it('outranks the outbound ride, which already happened', () => {
        expect(state({ dropoffOpen: true, activeRide: { status: 'assigned' } }).kind)
            .toBe('ready-to-leave');
    });

    it('is not offered at all when the window is shut', () => {
        // The old screen kept this card on screen roughly six days out of seven,
        // greyed out behind a blur. Now it simply is not there.
        expect(state({ dropoffOpen: false }).kind).not.toBe('ready-to-leave');
    });
});

describe('splitInfo — a family in two cars', () => {
    it('is null for an ordinary single ride', () => {
        expect(splitInfo([{ status: 'assigned' }])).toBeNull();
    });

    it('is null when a group is all in one car', () => {
        expect(splitInfo([
            { groupId: 'g1', status: 'assigned', seatsRequested: 3 },
        ])).toBeNull();
    });

    it('is null when every leg is still waiting — nobody has been separated yet', () => {
        expect(splitInfo([
            { groupId: 'g1', status: 'requested', seatsRequested: 3 },
            { groupId: 'g1', status: 'requested', seatsRequested: 2 },
        ])).toBeNull();
    });

    it('reports how many are away and how many are left', () => {
        expect(splitInfo([
            { groupId: 'g1', status: 'assigned', seatsRequested: 3, driverName: 'Ramesh', groupSeatsTotal: 5 },
            { groupId: 'g1', status: 'requested', seatsRequested: 2, groupSeatsTotal: 5 },
        ])).toEqual({
            totalSeats: 5,
            assignedSeats: 3,
            waitingSeats: 2,
            driverName: 'Ramesh',
        });
    });

    it('falls back to summing the legs when the group total is missing', () => {
        expect(splitInfo([
            { groupId: 'g1', status: 'assigned', seatsRequested: 3, driverName: 'R' },
            { groupId: 'g1', status: 'requested', seatsRequested: 2 },
        ])?.totalSeats).toBe(5);
    });

    it('treats a leg with no seat count as one person', () => {
        expect(splitInfo([
            { groupId: 'g1', status: 'assigned', driverName: 'R' },
            { groupId: 'g1', status: 'requested' },
        ])).toMatchObject({ assignedSeats: 1, waitingSeats: 1, totalSeats: 2 });
    });

    it('is attached to the driver-assigned state so the waiting half is visible', () => {
        const rides = [
            { groupId: 'g1', status: 'assigned', seatsRequested: 3, driverName: 'Ramesh' },
            { groupId: 'g1', status: 'requested', seatsRequested: 2 },
        ];
        const result = state({ activeRide: rides[0], activeRides: rides });

        expect(result).toMatchObject({ kind: 'driver-assigned' });
        expect(result.kind === 'driver-assigned' && result.split?.waitingSeats).toBe(2);
    });
});
