/**
 * Putting a carload back in the pool, in one place.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `releaseAssignment` held the only server-side version of this, inline in the
 * callable: return every assigned rider to the waiting pool, and reset the ride
 * so dispatch can offer it to somebody else. `managerSetUserRole` needs exactly
 * the same thing when it demotes a Sarthi who still has riders on their sheet.
 *
 * Copying it would have been the smaller diff and the wrong one. The fields this
 * clears are the fields `firestore.rules` calls `touchesRideServerFields()`, and
 * the list has already drifted once in this repo — `returnStudentToPool` in
 * hooks/useRides.ts nulls `driverId` but leaves `peers` and `assignedStudentIds`
 * populated, and writes the rider status `'waiting'`, which is not in the
 * `StudentStatus` union at all. Two divergent copies is how that happened. A
 * third would be how it happens again.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not touch the DRIVER's document, because the two callers legitimately
 * want different things there and merging them would repeat the `releaseVehicle`
 * mistake (one function serving a manager hard-release and a driver car-swap,
 * doing the second one active harm):
 *
 *   - releaseAssignment: the driver declined one run and stays on shift in their
 *     car — `status: 'available'`, `activeRideId: null`, vehicle untouched.
 *   - managerSetUserRole: the driver is ceasing to be a driver — everything goes,
 *     including the car, via releaseVehiclesHeldBy.
 *
 * So the driver half stays at the call sites, where the intent is visible.
 */

import * as admin from 'firebase-admin';

/**
 * A ride in any of these means the car is out on the road right now.
 *
 * This exact four-element list was written out SEVEN times across `functions/`
 * under three different names — `ACTIVE_RIDE_STATUSES` in managerReleaseVehicle
 * and releaseIdleVehicles, `IN_FLIGHT_STATUSES` in deleteSabhaEvent, and inline
 * literals in manualAssignStudent and driverDoneForToday. (completeRide and
 * expireStaleRequests hold five-element variants that mean something different —
 * those are deliberately NOT this list.)
 *
 * The two that already spelled it identically under this very name now import it.
 * The rest are left alone rather than renamed in passing: they are reachable from
 * here when somebody is next in those files.
 */
export const ACTIVE_RIDE_STATUSES = ['assigned', 'driver_en_route', 'arriving', 'in_progress'] as const;

/**
 * The subset that means the run has actually STARTED — a Sarthi is driving, and
 * children may be in the car.
 *
 * `assigned` is deliberately outside it. An assigned ride is a proposal on a
 * screen: nobody has moved, so it can be handed back to the pool safely. Once the
 * status is past that, undoing it silently would leave the driver's screen
 * disagreeing with the people sitting behind them.
 */
export const UNDERWAY_RIDE_STATUSES = ['driver_en_route', 'arriving', 'in_progress'] as const;

/**
 * Where a rider goes when their assignment is undone.
 *
 * Direction matters: on the way out they are waiting at home to be collected, on
 * the way back they are at the sabha waiting to be taken home. Putting a
 * drop-off rider back into `waiting_for_pickup` is what made the manager's queue
 * and the driver's screen disagree in public on 2026-08-14.
 */
export function poolStatusFor(rideType: unknown): 'waiting_for_pickup' | 'waiting_for_dropoff' {
    return rideType === 'home-to-sabha' ? 'waiting_for_pickup' : 'waiting_for_dropoff';
}

/**
 * The fields a ride must lose to be offerable again.
 *
 * Kept as a named constant so it can be asserted against
 * `touchesRideServerFields()` in firestore.rules rather than eyeballed. Every
 * one of these is written by the assignment pipeline, so leaving any of them
 * behind produces a ride that looks assigned to a driver who is not coming.
 */
export const RIDE_RETURNED_TO_POOL = {
    status: 'requested',
    driverId: null,
    // The nested object as well as the flat id. The rider's card reads `driver`
    // and does `if (!driver) return null`, so clearing only `driverId` leaves a
    // card still naming a Sarthi who has been taken off the run.
    driver: null,
    driverName: null,
    carId: null,
    carModel: null,
    carColor: null,
    carLicensePlate: null,
    route: [],
    peers: [],
    assignedStudentIds: [],
    assignedAt: null,
} as const;

/**
 * Stage the return of one ride and everybody on it to the unassigned pool.
 *
 * Staged into a caller-supplied batch, never committed here: a demotion frees a
 * car, rewrites four role fields and releases several rides, and a half-applied
 * version of that is the split-brain state this whole area keeps producing.
 *
 * Returns the rider uids moved, so the caller can say so in its audit row.
 */
export function releaseRideToPool(
    batch: admin.firestore.WriteBatch,
    db: admin.firestore.Firestore,
    rideId: string,
    ride: Record<string, any> | undefined,
    now: Date = new Date(),
): string[] {
    const poolStatus = poolStatusFor(ride?.rideType);
    const moved: string[] = [];

    // `students[]` is the roster on an assigned ride. Falling back to the single
    // `studentId` matters: a ride that was assigned before the roster field
    // existed, or one carrying a lone rider, has the uid only in that field, and
    // missing it would strand somebody as `assigned` to a ride that is back in
    // the pool — visible to nobody, waiting for a car that will never come.
    const riders: string[] = Array.isArray(ride?.students) && ride!.students.length > 0
        ? ride!.students.map((s: any) => s?.id).filter((id: any): id is string => typeof id === 'string')
        : (typeof ride?.studentId === 'string' ? [ride.studentId] : []);

    for (const uid of riders) {
        batch.update(db.collection('users').doc(uid), {
            status: poolStatus,
            currentRideId: null,
        });
        moved.push(uid);
    }

    batch.update(db.collection('rides').doc(rideId), {
        ...RIDE_RETURNED_TO_POOL,
        // Stamped so the sweep and the manager's board can tell a ride that was
        // never picked up from one that was taken off a driver.
        unassignedAt: now.toISOString(),
    });

    return moved;
}
