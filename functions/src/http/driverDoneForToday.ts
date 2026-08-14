// ============================================
// HTTP FUNCTION: driverDoneForToday
// Triggered when driver clicks "No, I'm Done for Today"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
    writeVehicleState, resolveDriverVehicleId, VEHICLE_RELEASED, DRIVER_VEHICLE_CLEARED,
} from '../utils/fleet';

/**
 * HTTP Callable: Driver done for today
 * Releases car and clears driver session
 * Input: { driverId: string }
 * Output: Success confirmation
 */
export const driverDoneForToday = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { driverId } = data;

    if (!driverId) {
        throw new functions.https.HttpsError('invalid-argument', 'driverId is required');
    }

    const db = admin.firestore();

    try {
        // Get driver details
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }

        const driver = driverDoc.data();

        // Verify the caller is the driver
        if (driverId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the driver can mark themselves done');
        }

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
            driverId,
            carReleased: !!vehicleId,
            message: 'You are now offline. Thank you for your service!'
        };

    } catch (error) {
        console.error('Error marking driver done:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to mark driver done');
    }
});
