// ============================================
// HTTP FUNCTION: driverDoneForToday
// Triggered when driver clicks "No, I'm Done for Today"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

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
        const driverDoc = await db.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }

        const driver = driverDoc.data();

        // Verify the caller is the driver
        if (driver?.userId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the driver can mark themselves done');
        }

        // Check if driver has an active ride
        if (driver?.activeRideId) {
            throw new functions.https.HttpsError('failed-precondition', 'Cannot mark done while in an active ride');
        }

        const carId = driver?.currentCarId;
        const batch = db.batch();

        // Release car if assigned
        if (carId) {
            batch.update(db.collection('cars').doc(carId), {
                status: 'available',
                assignedDriverId: null
            });
        }

        // Update driver status
        batch.update(db.collection('drivers').doc(driverId), {
            status: 'offline',
            currentCarId: null,
            activeRideId: null
        });

        await batch.commit();

        return {
            success: true,
            driverId,
            carReleased: !!carId,
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
