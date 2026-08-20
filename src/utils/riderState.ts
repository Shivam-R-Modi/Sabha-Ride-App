/**
 * What the rider's home screen is showing, as one value.
 *
 * WHY THIS IS A FUNCTION AND NOT JSX
 * ----------------------------------
 * The old screen answered "what should I show?" with four early returns and five
 * conditional blocks scattered through the render. Two of those returns replaced
 * the ENTIRE dashboard — the attendance question and the "you said no" screen —
 * so a one-bit answer took the whole app hostage, and the ordering between them
 * was implicit in where they happened to sit in the file.
 *
 * Pulling it out makes the priority order explicit, reviewable and testable
 * without rendering anything. Every branch below is a decision about what a
 * rider most needs to know at that moment, and each one is ordered against the
 * others on purpose.
 *
 * THE SCREEN SHOWS EXACTLY ONE OF THESE, WITH AT MOST ONE ACTION.
 */

import { seatsOf } from '../constants/seats';

export interface SplitInfo {
    totalSeats: number;
    assignedSeats: number;
    waitingSeats: number;
    driverName: string;
}

export interface DismissedInfo {
    managerName?: string;
    managerContact?: string;
    dismissedAt?: string;
}

export type RiderState =
    /** Nothing is known yet. Show a skeleton, never an empty state. */
    | { kind: 'loading' }
    /** A manager has cancelled everything in the horizon. Not a fault. */
    | { kind: 'no-sabha' }
    /** A manager turned this rider's request down. */
    | { kind: 'dismissed'; info: DismissedInfo }
    /** Drop-off is open and they have asked to go home. */
    | { kind: 'in-dropoff-queue' }
    /** Drop-off is open and they have not asked yet. */
    | { kind: 'ready-to-leave' }
    /** A driver is coming, or they are already in the car. */
    | { kind: 'driver-assigned'; split: SplitInfo | null }
    /** Requested, nobody assigned yet. */
    | { kind: 'waiting-for-driver' }
    /** We have not asked them about this sabha yet. */
    | { kind: 'attendance-unanswered' }
    /** They said they are not coming. */
    | { kind: 'not-coming' }
    /** Coming, and free to book. */
    | { kind: 'can-request' }
    /**
     * They are driving tonight, so they are not a passenger.
     *
     * The role hierarchy grants a Sarthi the Bhulku hat deliberately, so they can
     * see these screens. This is what stops them USING the request button while
     * holding a car — dispatch would otherwise assign them their own request, a
     * phantom passenger occupying a real seat in their own vehicle.
     */
    | { kind: 'driving-tonight' };

interface RideLike {
    status?: string;
    groupId?: string;
    groupSeatsTotal?: number;
    seatsRequested?: unknown;
    driverName?: string;
    driver?: { name?: string } | null;
    dropoffRequested?: boolean;
}

export interface RiderInputs {
    loading: boolean;
    hasEvent: boolean;
    /** True only while the server says the current leg is sabha → home. */
    dropoffOpen: boolean;
    activeRide: RideLike | null | undefined;
    activeRides: RideLike[] | null | undefined;
    hasResponded: boolean;
    attendanceResponse: 'yes' | 'no' | null;
    dismissedRequest: DismissedInfo | null | undefined;
    /**
     * Is this person holding a car right now?
     *
     * Holding a car is the definition `driverDoneForToday` uses for "on shift",
     * because holding a car is exactly what lets a driver be assigned riders.
     * Reusing it keeps the two screens agreeing about who is driving.
     *
     * Required, not optional: a default here would silently offer a lift to a
     * Sarthi who is about to drive, which is the bug this input exists to stop.
     */
    onShift: boolean;
}

/**
 * Is this rider's party travelling in more than one car?
 *
 * A group too large for any vehicle is split, leaving two live rides: one with a
 * driver and one still waiting. A ride card renders only the first, and on its
 * own that reads as "everyone is sorted" — which for a family still standing
 * outside is simply untrue.
 *
 * Null whenever nothing is split, which is the ordinary case.
 */
export function splitInfo(rides: RideLike[] | null | undefined): SplitInfo | null {
    const legs = (rides ?? []).filter(r => r.groupId);
    if (legs.length < 2) return null;

    const assigned = legs.filter(r => r.status !== 'requested');
    const waiting = legs.filter(r => r.status === 'requested');
    if (assigned.length === 0 || waiting.length === 0) return null;

    return {
        totalSeats: legs[0].groupSeatsTotal ?? legs.reduce((n, r) => n + seatsOf(r), 0),
        assignedSeats: assigned.reduce((n, r) => n + seatsOf(r), 0),
        waitingSeats: waiting.reduce((n, r) => n + seatsOf(r), 0),
        driverName: assigned[0].driverName || assigned[0].driver?.name || '',
    };
}

export function deriveRiderState(input: RiderInputs): RiderState {
    // 1. Never guess while data is in flight. An empty state shown early reads
    //    as "you have no ride", which is the most alarming possible lie.
    if (input.loading) return { kind: 'loading' };

    // 2. No gathering means every other branch is about nothing.
    if (!input.hasEvent) return { kind: 'no-sabha' };

    // 2b. Driving tonight outranks every branch below, because none of them apply
    //     to somebody behind the wheel: they need no lift out, no lift home, and
    //     their attendance is settled by the fact that they are driving to it. It
    //     sits above the dismissal too — a turned-down lift request stops mattering
    //     once you are holding a car.
    //
    //     BUT NOT above a live ride, which is why the guard is here rather than the
    //     ordering. If they asked for a lift and then went on shift, that request is
    //     real and needs resolving; hiding it behind "you are driving" would strand
    //     it where nobody can see it. Showing it is what lets them withdraw it.
    if (input.onShift && !input.activeRide) return { kind: 'driving-tonight' };

    // 3. Above the ride states on purpose. A dismissal is the one thing here the
    //    rider cannot discover any other way, and it needs acting on tonight.
    if (input.dismissedRequest && !input.activeRide) {
        return { kind: 'dismissed', info: input.dismissedRequest };
    }

    // 4. Drop-off outranks everything below it. Once the evening turns for home,
    //    "how do I get back?" is the only live question — the trip out already
    //    happened, and attendance is settled by the fact that they are here.
    if (input.dropoffOpen) {
        return input.activeRide?.dropoffRequested
            ? { kind: 'in-dropoff-queue' }
            : { kind: 'ready-to-leave' };
    }

    // 5. A live ride outranks the attendance question: someone who has booked has
    //    self-evidently answered it, whatever the attendance document says.
    if (input.activeRide) {
        return input.activeRide.status === 'requested'
            ? { kind: 'waiting-for-driver' }
            : { kind: 'driver-assigned', split: splitInfo(input.activeRides) };
    }

    // 6. Ask before offering. Requesting a ride to a sabha you are not attending
    //    is not a thing anyone wants to be offered first.
    if (!input.hasResponded) return { kind: 'attendance-unanswered' };
    if (input.attendanceResponse === 'no') return { kind: 'not-coming' };

    return { kind: 'can-request' };
}
