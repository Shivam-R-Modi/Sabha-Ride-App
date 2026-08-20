// ============================================
// HTTP FUNCTION: driverDoneForToday
// Triggered when driver clicks "No, I'm Done for Today"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
    writeVehicleState, resolveDriverVehicleId, VEHICLE_RELEASED, DRIVER_VEHICLE_CLEARED,
} from '../utils/fleet';
// The dispatch pool's own filter. Shared deliberately — see surveyTheQueue.
import { isAssignableTo } from './globalAssignDriver';
import { RideType } from '../types';
import { assertApprovedDriver } from '../utils/authz';

/**
 * Should this driver be warned before they finish?
 *
 * Warn, never block. A volunteer is always allowed to go home — the failure this
 * guards against is not "a driver left", it is "a driver left without knowing
 * anyone was still waiting". Measured on 2026-08-14: both drivers tapped done
 * within four minutes of each other while two riders sat at the temple with
 * open requests, and nothing on any screen said so.
 *
 * Only fires when BOTH are true: somebody is waiting, and nobody else can serve
 * them. A queue with other drivers still on shift is the ordinary case and must
 * stay silent, or the prompt becomes noise and gets tapped through unread.
 *
 * Pure, and exported, because this condition is the whole of the behaviour.
 */
export function decideDoneWarning(
    waitingCount: number,
    otherDriversOnShift: number,
): string | null {
    if (waitingCount <= 0) return null;
    if (otherDriversOnShift > 0) return null;

    const people = waitingCount === 1 ? '1 rider is' : `${waitingCount} riders are`;
    return `${people} still waiting, and you are the last driver on shift.\n\n`
        + 'If you finish now, nobody can pick them up tonight.';
}

/**
 * Count what the warning needs: unserved requests, and anyone else who could
 * serve them.
 *
 * "On shift" is defined as holding a car, because holding a car is exactly what
 * lets a driver be assigned riders — globalAssignDriver refuses without one. So
 * the fleet is the register of who is available, and it is three documents.
 *
 * WHY THIS SHARES isValidPendingRide RATHER THAN FILTERING ITS OWN WAY
 * -------------------------------------------------------------------
 * A "rider is still waiting" warning is only true if that rider CAN be picked
 * up. The one thing that decides that is the dispatch pool, so the two have to
 * be the same question — and when this counted for itself, they drifted.
 *
 * This used to match on the event key alone. `isValidPendingRide` also filters
 * by DIRECTION, and a pickup request writes no `rideType` field while a drop-off
 * stamps `sabha-to-home`. So during a drop-off run, a leftover pickup request
 * from earlier the same evening counted here and was correctly excluded there.
 *
 * Observed on 2026-08-17: "End my shift" warned *1 rider is still waiting*, and
 * "Find my next riders" answered *no one is left* — same driver, same second, two
 * contradictory screens, and no way to tell which was lying. Staying on shift
 * could not have helped, because the request was not dispatchable to anybody.
 *
 * Sharing the function also inherits its coordinate and studentId checks, which
 * is the same argument: a request with no usable pickup point cannot be served
 * by staying, so warning about it only teaches the driver to tap through.
 *
 * It shares `isAssignableTo`, not `isValidPendingRide`, for that same reason: the
 * pool excludes the caller's OWN waiting request, because a driver is never their
 * own passenger. Counting it here would warn "1 rider is still waiting" about
 * themselves while "Find my next riders" answered "no one is left" — the identical
 * pair of contradictory screens described above, from a new cause.
 *
 * An absent `rideType` on the CONTEXT means no window is open, and
 * globalAssignDriver refuses outright in that state — so nothing is dispatchable
 * and there is nothing to warn about.
 */
async function surveyTheQueue(
    db: admin.firestore.Firestore,
    driverId: string,
): Promise<{ waitingCount: number; otherDriversOnShift: number }> {
    const ctx = (await db.collection('system').doc('rideContext').get()).data();
    const eventId: string | null = ctx?.eventId ?? null;
    const rideType = ctx?.rideType as RideType | undefined;

    const [requested, held] = await Promise.all([
        db.collection('rides').where('status', '==', 'requested').get(),
        db.collection('vehicles').where('status', '==', 'in_use').get(),
    ]);

    const waitingCount = !eventId || !rideType
        ? 0
        : requested.docs.filter(d => isAssignableTo(d.data(), driverId, eventId, rideType)).length;

    const otherDriversOnShift = new Set(
        held.docs
            .map(d => d.data()?.assignedDriverId)
            .filter((uid): uid is string => typeof uid === 'string' && uid !== driverId),
    ).size;

    return { waitingCount, otherDriversOnShift };
}

/**
 * HTTP Callable: Driver done for today
 * Releases car and clears driver session
 * Input: { driverId: string, acknowledgeWaiting?: boolean }
 * Output: Success confirmation, or a confirmation request that released nothing
 */
export const driverDoneForToday = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { driverId, acknowledgeWaiting } = data;

    if (!driverId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId is required');
    }

    const db = admin.firestore();

    // IDENTITY FIRST, THEN THE READ.
    //
    // The uid comparison used to sit AFTER the target document was fetched, so any
    // authenticated caller could tell a real uid from a made-up one by which error
    // came back — 'Driver not found' against 'permission-denied'. An existence
    // oracle over the user collection, for free.
    //
    // The role check is new too. Self-only is not the same as allowed: a rejected
    // account could still end a shift and release a car.
    if (driverId !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'Only the Sarthi can mark themselves done');
    }

    const driver = await assertApprovedDriver(db, context.auth.uid, 'end their shift');

    try {

        // Check if driver has an active ride
        if (driver?.activeRideId) {
            throw new functions.https.HttpsError('failed-precondition', 'Cannot mark done while in an active ride');
        }

        // …and check the RIDES, not just the pointer.
        //
        // `activeRideId` names one ride. A driver assigned a carload holds several
        // ride documents — one per rider — and on a split it is more than one per
        // family. It is also only a pointer: `returnStudentToPool` cleared the
        // ride's driverId and left it dangling, so it has been both wrong and
        // stale in production on the same day.
        //
        // "Done for today" means everyone is home and so am I. Letting it through
        // while riders are still assigned would release the car and set the driver
        // offline with people still expecting to be collected — and nothing
        // anywhere would say so. This is the one action where failing closed
        // costs a driver a tap and failing open strands a child.
        const stillAssigned = await db.collection('rides')
            .where('driverId', '==', driverId)
            .where('status', 'in', ['assigned', 'driver_en_route', 'arriving', 'in_progress'])
            .get();

        if (!stillAssigned.empty) {
            const names = stillAssigned.docs
                .map(d => d.data()?.studentName)
                .filter(Boolean)
                .join(', ');
            throw new functions.https.HttpsError(
                'failed-precondition',
                `You still have ${stillAssigned.size} rider(s) assigned`
                + `${names ? ` — ${names}` : ''}. Complete or release them first.`,
            );
        }

        // Nobody of THEIRS is left. Now: is anybody else's rider left, and is
        // this driver the only one who could still take them?
        //
        // Deliberately after the hard guard and before any write, and deliberately
        // a return rather than a throw — the caller has to be able to say "yes,
        // I'm going anyway" and have that respected on the second call.
        if (!acknowledgeWaiting) {
            const { waitingCount, otherDriversOnShift } = await surveyTheQueue(db, driverId);
            const warning = decideDoneWarning(waitingCount, otherDriversOnShift);

            if (warning) {
                return {
                    success: false,
                    needsConfirmation: true,
                    driverId,
                    carReleased: false,
                    waitingCount,
                    warning,
                    message: warning,
                };
            }
        }

        // Only reached once nobody is left. `currentCarId` is the older name for
        // the same thing and can only resolve documents written before both were
        // cleared together.
        const vehicleId = resolveDriverVehicleId(driver);
        const batch = db.batch();

        // Release vehicle if assigned (both halves of the mirror)
        if (vehicleId) {
            writeVehicleState(batch, db, vehicleId, VEHICLE_RELEASED);
        }

        // Update driver status and reset daily session counters
        batch.update(db.collection('users').doc(driverId), {
            status: 'offline',
            ...DRIVER_VEHICLE_CLEARED,
            currentVehicleName: null,
            currentVehiclePlate: null,
            carModel: null,
            carColor: null,
            plateNumber: null,
            activeRideId: null,
            ridesCompletedToday: 0,
            totalStudentsToday: 0,
            totalDistanceToday: 0
        });

        await batch.commit();

        return {
            success: true,
            needsConfirmation: false,
            driverId,
            carReleased: !!vehicleId,
            message: 'You are now offline. Thank you for your service!'
        };

    } catch (error) {
        console.error('Error marking driver done:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to mark Sarthi done');
    }
});
