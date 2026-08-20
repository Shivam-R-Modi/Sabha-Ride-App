// ============================================
// HTTP FUNCTION: releaseAssignment
// Triggered when driver clicks "Release Assignment" in AssignmentPreview
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedDriver } from '../utils/authz';
// The fleet helpers were imported to release the car when an assignment was
// declined. Nothing here touches the fleet now — see the driver update below.

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

        // OWNERSHIP IS NOT AUTHORISATION.
        //
        // This checked only that the caller was the Sarthi named on the ride. That
        // let a REVOKED or rejected account keep full control of ride state for as
        // long as its name sat on a document — flipping a whole car to in_progress,
        // marking rides complete, moving every passenger's status. Revoking the
        // account did not reach it. `sarthiArrived` already said as much in a
        // comment: "Stricter than startRide/completeRide, which check ownership
        // only."
        //
        // Placed before any document read, so nothing is fetched for a caller who
        // has no business here.
    await assertApprovedDriver(db, context.auth.uid, 'release an assignment');

    try {
        // Get ride details
        const rideDoc = await db.collection('rides').doc(rideId).get();
        if (!rideDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }

        const ride = rideDoc.data();

        // Verify the caller is the driver assigned to this ride
        if (ride?.driverId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned Sarthi can release this assignment');
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

        // THE DRIVER KEEPS THEIR CAR.
        //
        // Declining a proposed run is an ordinary thing to do — the preview
        // exists so a driver can look at who they have been given and say no.
        // This used to release their vehicle and clear `currentVehicleId` too, so
        // saying no to one carload dropped them off shift and put their car back
        // into every other driver's picker. A driver could decline a run and lose
        // the car they had been using all evening to someone else.
        //
        // Only `driverDoneForToday` releases now. A driver who stops without
        // saying so is caught by releaseIdleVehicles at 03:00, or freed sooner by
        // managerReleaseVehicle. Same change as completeRide, for the same
        // reason: one run ending is not the evening ending.
        //
        // `activeRideId` still clears — that assignment really is over.
        batch.update(db.collection('users').doc(ride?.driverId), {
            status: 'available',
            activeRideId: null,
        });

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
            message: 'Assignment released successfully. Bhulka returned to unassigned pool.',
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
