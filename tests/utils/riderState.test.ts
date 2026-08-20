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
    onShift: false,
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

describe('deriveRiderState — driving tonight', () => {
    /**
     * ONE PERSON CANNOT BE BOTH DRIVER AND PASSENGER.
     *
     * The role hierarchy grants a Sarthi the Bhulku hat on purpose, so they can see
     * these screens. Nothing stopped them USING the request button, and dispatch
     * would then happily assign them their own request — a phantom passenger in
     * their own car. The server refuses that now; this is the half that stops the
     * request being made at all, and says why.
     *
     * "On shift" is holding a car, the same definition driverDoneForToday uses:
     * holding a car is exactly what lets a driver be assigned riders.
     */
    it('tells a driver holding a car that they are driving, instead of offering a ride', () => {
        expect(state({ onShift: true })).toEqual({ kind: 'driving-tonight' });
    });

    it('outranks the attendance question — driving IS attending', () => {
        expect(state({ onShift: true, hasResponded: false })).toEqual({ kind: 'driving-tonight' });
        expect(state({ onShift: true, attendanceResponse: 'no' })).toEqual({ kind: 'driving-tonight' });
    });

    it('outranks the offer of a lift home', () => {
        // They have a car. Asking whether they want driving home is nonsense.
        expect(state({ onShift: true, dropoffOpen: true })).toEqual({ kind: 'driving-tonight' });
    });

    it('outranks a stale dismissal', () => {
        expect(state({ onShift: true, dismissedRequest: { managerName: 'Mira' } }))
            .toEqual({ kind: 'driving-tonight' });
    });

    it('does NOT hide a ride they are already holding as a passenger', () => {
        // The conflict state: they asked for a lift and then went on shift. Showing
        // the ride is what lets them resolve it; hiding it behind "you are driving"
        // would strand a real request nobody can see.
        expect(state({ onShift: true, activeRide: { status: 'requested' } }))
            .toEqual({ kind: 'waiting-for-driver' });
        expect(state({ onShift: true, activeRide: { status: 'assigned' } }))
            .toEqual({ kind: 'driver-assigned', split: null });
    });

    it('still never guesses while loading, or with no sabha', () => {
        expect(state({ onShift: true, loading: true })).toEqual({ kind: 'loading' });
        expect(state({ onShift: true, hasEvent: false })).toEqual({ kind: 'no-sabha' });
    });

    it('changes nothing for a rider who is not on shift', () => {
        expect(state({ onShift: false })).toEqual({ kind: 'can-request' });
    });
});
