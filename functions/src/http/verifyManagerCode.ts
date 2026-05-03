// ============================================
// HTTP FUNCTION: verifyManagerCode
// Server-side verification of manager access code
// Now reads from Firestore settings instead of hard-coded constant
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * HTTP Callable: Verify manager access code
 * Input: { code: string }
 * Output: { valid: boolean }
 *
 * If valid, auto-approves the calling user's account.
 * Manager code is stored in Firestore: settings/managerCode
 */
export const verifyManagerCode = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { code } = data;

    if (!code || typeof code !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Access code is required');
    }

    const db = admin.firestore();
    const userId = context.auth.uid;

    try {
        // Get user profile to verify they selected manager role
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User profile not found');
        }

        const userData = userDoc.data();
        if (userData?.role !== 'manager' && userData?.registeredRole !== 'manager') {
            throw new functions.https.HttpsError('permission-denied', 'Only manager accounts can verify access codes');
        }

        // Read manager code from Firestore settings (not hard-coded)
        const managerCodeDoc = await db.collection('settings').doc('managerCode').get();

        if (!managerCodeDoc.exists) {
            // Fallback: If no code in Firestore, reject (managers must set code first)
            throw new functions.https.HttpsError('failed-precondition', 'Manager access code not configured. Please contact administrator.');
        }

        const managerCodeData = managerCodeDoc.data();
        const validCode = managerCodeData?.code;

        if (!validCode) {
            throw new functions.https.HttpsError('failed-precondition', 'Manager access code not configured properly.');
        }

        // Verify the code
        const isValid = code === validCode;

        if (isValid) {
            // Auto-approve the manager account
            await db.collection('users').doc(userId).update({
                accountStatus: 'approved',
            });
        }

        return { valid: isValid };
    } catch (error) {
        console.error('Error verifying manager code:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to verify access code');
    }
});
