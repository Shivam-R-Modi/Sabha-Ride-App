// ============================================
// HTTP FUNCTION: adminDeleteUser
// Server-side permanent deletion of user profile,
// mirror documents (students, drivers, cars), and Firebase Auth account.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';

export const adminDeleteUser = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { targetUserId, targetUserIds } = data;
    const callerUid = context.auth.uid;
    const db = admin.firestore();

    try {
        // 1. Verify caller is an approved manager.
        // This check omitted the `roles` array arm, so it disagreed with the other
        // four call sites and with firestore.rules: a manager whose document
        // records the role only in `roles[]` was refused here while passing
        // everywhere else.
        const callerData = await assertApprovedManager(db, callerUid, 'delete users');

        // Collect array of target UIDs to delete
        const uidsToDelete: string[] = [];
        if (typeof targetUserId === 'string' && targetUserId.trim()) {
            uidsToDelete.push(targetUserId.trim());
        }
        if (Array.isArray(targetUserIds)) {
            targetUserIds.forEach((id) => {
                if (typeof id === 'string' && id.trim()) {
                    uidsToDelete.push(id.trim());
                }
            });
        }

        if (uidsToDelete.length === 0) {
            throw new functions.https.HttpsError('invalid-argument', 'targetUserId or targetUserIds is required');
        }

        let deletedAuthCount = 0;
        let deletedFirestoreCount = 0;

        for (const uid of uidsToDelete) {
            const batch = db.batch();

            // Delete Firestore documents across collections
            batch.delete(db.collection('users').doc(uid));
            batch.delete(db.collection('students').doc(uid));
            batch.delete(db.collection('drivers').doc(uid));
            batch.delete(db.collection('vehicles').doc(uid));
            batch.delete(db.collection('cars').doc(uid));

            await batch.commit();
            deletedFirestoreCount++;

            // Delete Firebase Authentication Account via Admin SDK
            try {
                await admin.auth().deleteUser(uid);
                deletedAuthCount++;
            } catch (authErr: any) {
                // If user doesn't exist in Auth or was already deleted, log warning
                console.warn(`Auth deletion warning for UID ${uid}:`, authErr.message || authErr);
            }

            // Log Audit Entry
            try {
                await db.collection('auditLogs').add({
                    timestamp: new Date().toISOString(),
                    managerId: callerUid,
                    managerName: callerData?.name || 'Manager',
                    action: 'DELETE',
                    collection: 'users',
                    documentId: uid,
                    details: 'Admin permanently deleted user Firestore record and Firebase Auth account'
                });
            } catch (auditErr) {
                console.warn('Audit log write error:', auditErr);
            }
        }

        return {
            success: true,
            deletedCount: uidsToDelete.length,
            deletedAuthCount,
            deletedFirestoreCount
        };

    } catch (error) {
        console.error('Error in adminDeleteUser:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to permanently delete user(s)');
    }
});
