// ============================================
// HTTP FUNCTION: releaseAssignment
// Triggered when driver clicks "Release Assignment" in AssignmentPreview
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * HTTP Callable: Release a ride assignment
 * Input: { rideId: string }
 * Output: Success confirmation
 */
export const releaseAssignment = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { rideId } = data;

    if (!rideId) {
        throw new functions.https.HttpsError('invalid-argument', 'rideId is required');
    }

    const db = admin.firestore();

    try {
        // Get ride details
        const rideDoc = await db.collection('rides').doc(rideId).get();
        if (!rideDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }

        const ride = rideDoc.data();

        // Verify the caller is the driver assigned to this ride
        const driverDoc = await db.collection('drivers').doc(ride?.driverId).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver not found');
        }

        const driver = driverDoc.data();
        if (driver?.userId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned driver can release this assignment');
        }

        // Check ride status - can only release if status is 'assigned'
        if (ride?.status !== 'assigned') {
            throw new functions.https.HttpsError('failed-precondition', 'Ride can only be released when in assigned status');
        }

        const batch = db.batch();

        // Determine new student status based on ride type
        const newStudentStatus = ride?.rideType === 'home-to-sabha' ? 'waiting_for_pickup' : 'waiting_for_dropoff';

        // Return all assigned students to the unassigned pool
        for (const student of ride?.students || []) {
            batch.update(db.collection('students').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });
        }

        // Update driver status to ready_for_assignment and clear activeRideId
        batch.update(db.collection('drivers').doc(ride?.driverId), {
            status: 'ready_for_assignment',
            activeRideId: null
        });

        // Update car status back to available
        const carId = ride?.carId;
        if (carId) {
            batch.update(db.collection('cars').doc(carId), {
                status: 'available',
                assignedDriverId: null
            });
        }

        // Delete the ride document
        batch.delete(db.collection('rides').doc(rideId));

        await batch.commit();

        return {
            success: true,
            rideId,
            message: 'Assignment released successfully. Students returned to unassigned pool.',
            studentsReturned: ride?.students?.length || 0,
            newStudentStatus
        };

    } catch (error) {
        console.error('Error releasing assignment:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to release assignment');
    }
});
