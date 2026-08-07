// ============================================
// HTTP FUNCTION: releaseAssignment
// Triggered when driver clicks "Release Assignment" in AssignmentPreview
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { writeVehicleState, VEHICLE_RELEASED, DRIVER_VEHICLE_CLEARED } from '../utils/fleet';

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
        if (ride?.driverId !== context.auth.uid) {
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
            batch.update(db.collection('users').doc(student.id), {
                status: newStudentStatus,
                currentRideId: null
            });
        }

        // Clear the driver's vehicle under BOTH names. Clearing only
        // currentVehicleId left a stale currentCarId behind, and
        // driverDoneForToday falls back to it — releasing a car that another
        // driver had since been given.
        batch.update(db.collection('users').doc(ride?.driverId), {
            status: 'available',
            activeRideId: null,
            ...DRIVER_VEHICLE_CLEARED
        });

        // Update vehicle status back to available, in both collections.
        const vehicleId = ride?.carId;
        if (vehicleId) {
            writeVehicleState(batch, db, vehicleId, VEHICLE_RELEASED);
        }

        // Reset ride document status to 'requested' so it returns to the unassigned queue
        batch.update(db.collection('rides').doc(rideId), {
            status: 'requested',
            driverId: null,
            driverName: null,
            carId: null,
            carModel: null,
            carColor: null,
            carLicensePlate: null,
            route: [],
            peers: [],
            assignedStudentIds: []
        });

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
