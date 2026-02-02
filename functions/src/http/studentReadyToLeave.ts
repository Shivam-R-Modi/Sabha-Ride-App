// ============================================
// HTTP FUNCTION: studentReadyToLeave
// Triggered when student clicks "Ready to Leave"
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * HTTP Callable: Student ready to leave Sabha
 * Updates student status for drop-off assignment
 * Input: { studentId: string }
 * Output: Success confirmation
 */
export const studentReadyToLeave = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { studentId } = data;

    if (!studentId) {
        throw new functions.https.HttpsError('invalid-argument', 'studentId is required');
    }

    const db = admin.firestore();

    try {
        // Get student details
        const studentDoc = await db.collection('students').doc(studentId).get();
        if (!studentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Student not found');
        }

        const student = studentDoc.data();

        // Verify the caller is the student
        if (student?.userId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the student can mark themselves ready');
        }

        // Check if student is at Sabha (must have completed pickup)
        if (student?.status !== 'at_sabha') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'You must be at Sabha to request drop-off'
            );
        }

        // Check if it's after 10 PM on Friday
        const now = new Date();
        const dayOfWeek = now.getDay();
        const hour = now.getHours();

        if (dayOfWeek !== 5 || hour < 22) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Drop-off requests only available after 10 PM on Friday'
            );
        }

        // Update student status
        await db.collection('students').doc(studentId).update({
            status: 'waiting_for_dropoff',
            dropoffRequested: true,
            currentRideId: null
        });

        return {
            success: true,
            studentId,
            message: 'You are now in the queue for drop-off',
            status: 'waiting_for_dropoff'
        };

    } catch (error) {
        console.error('Error marking student ready:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to mark student ready');
    }
});
