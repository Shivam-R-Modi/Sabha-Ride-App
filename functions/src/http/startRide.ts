// ============================================
// HTTP FUNCTION: startRide
// Triggered when driver clicks "Accept & Start"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { notifyStudentRideStarting, tokensOf } from '../utils/notifications';

/**
 * HTTP Callable: Start a ride
 * Input: { rideId: string }
 * Output: Success confirmation
 */
export const startRide = functions.https.onCall(async (data, context) => {
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
            throw new functions.https.HttpsError('permission-denied', 'Only the assigned Sarthi can start this ride');
        }

        // Check ride status
        if (ride?.status !== 'assigned') {
            throw new functions.https.HttpsError('failed-precondition', 'Ride is not in assigned status');
        }

        const batch = db.batch();
        const now = new Date().toISOString();

        // Find ALL active rides for this driver to start all documents in multi-student grouped rides
        const activeRidesSnap = await db.collection('rides')
            .where('driverId', '==', context.auth.uid)
            .where('status', '==', 'assigned')
            .get();

        for (const doc of activeRidesSnap.docs) {
            batch.update(doc.ref, {
                status: 'in_progress',
                startedAt: now
            });
        }

        // Update driver status
        batch.update(db.collection('users').doc(ride?.driverId), {
            status: 'active_ride'
        });

        // Update students status
        const destination = ride?.rideType === 'home-to-sabha' ? 'Sabha' : 'Home';
        for (const student of ride?.students || []) {
            batch.update(db.collection('users').doc(student.id), {
                status: 'in_ride'
            });

            // Send notification to student
            try {
                const studentDoc = await db.collection('users').doc(student.id).get();
                await notifyStudentRideStarting(tokensOf(student.id, studentDoc.data()));
            } catch (notifError) {
                console.error('Error sending notification to student:', student.id, notifError);
            }
        }

        await batch.commit();

        return {
            success: true,
            rideId,
            startedAt: now,
            destination
        };

    } catch (error) {
        console.error('Error starting ride:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to start ride');
    }
});
