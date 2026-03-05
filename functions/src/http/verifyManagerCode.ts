// ============================================
// HTTP FUNCTION: verifyManagerCode
// Server-side verification of manager access code
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Manager code stored server-side only — never exposed to client
const MANAGER_ACCESS_CODE = 'SABHA2024';

/**
 * HTTP Callable: Verify manager access code
 * Input: { code: string }
 * Output: { valid: boolean }
 * 
 * If valid, auto-approves the calling user's account.
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

        // Verify the code server-side
        const isValid = code === MANAGER_ACCESS_CODE;

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
