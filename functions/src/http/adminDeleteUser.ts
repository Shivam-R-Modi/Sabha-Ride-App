// ============================================
// HTTP FUNCTION: adminDeleteUser
// Server-side permanent deletion of user profile,
// mirror documents (students, drivers, cars), and Firebase Auth account.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager, isApprovedManagerData } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import { releaseVehiclesHeldBy } from '../utils/fleet';

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

        // Throttled because this one is irreversible.
        //
        // Deleting a user removes their Firestore document AND their Auth account.
        // There is no undo in the app, and `targetUserIds` accepts a BATCH, so a
        // single loop over this endpoint can empty the congregation faster than
        // anyone could notice and far faster than a 7-day point-in-time restore
        // could be decided on.
        //
        // 30/hour leaves ordinary housekeeping — pruning a handful of duplicate
        // or departed accounts — completely unaffected, while capping the damage
        // a runaway script or a stolen session can do before someone intervenes.
        // Same placement as the export: after the authority check, so a stranger
        // cannot spend a real manager's allowance.
        await checkRateLimit(callerUid, {
            maxRequests: 30,
            windowMs: 60 * 60 * 1000,
            functionName: 'adminDeleteUser',
        });

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

        // NO SELF-DELETION, AND NO DELETING ANOTHER MANAGER.
        //
        // There was neither guard, so one approved manager could delete every other
        // manager and their Auth accounts — and then themselves. Nothing in the app
        // could appoint a replacement afterwards: manager creation goes through
        // single-use invites, and creating an invite requires being an approved
        // manager. A congregation could be locked out of its own coordination tool
        // with no way back in short of the Admin SDK on the owner's Mac.
        //
        // `docs/compliance/ownership-and-handover.md` already states the intent —
        // "the last one cannot be removed", "lockout is the most common
        // self-inflicted outage in this design". This is the floor of that rule at
        // the only level the app can enforce today, with one manager tier.
        //
        // Demotion is the intended route: clear the role, then delete if wanted.
        if (uidsToDelete.includes(callerUid)) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'You cannot delete your own account. Ask another manager to do it.',
            );
        }

        for (const uid of uidsToDelete) {
            const target = await db.collection('users').doc(uid).get();
            if (isApprovedManagerData(target.data())) {
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    'That account is a manager. Remove the manager role first, then delete it.',
                );
            }
        }

        let deletedAuthCount = 0;
        let deletedFirestoreCount = 0;

        for (const uid of uidsToDelete) {
            const batch = db.batch();

            // Delete Firestore documents across collections
            batch.delete(db.collection('users').doc(uid));
            batch.delete(db.collection('students').doc(uid));
            batch.delete(db.collection('drivers').doc(uid));

            // Hand back any car this person was holding.
            //
            // This used to be `batch.delete(vehicles/{uid})` and
            // `batch.delete(cars/{uid})` — documents keyed by the USER's uid.
            // Vehicles have their own ids, so those two lines matched nothing on
            // any real fleet and quietly did NOTHING. Deleting a driver therefore
            // left `assignedDriverId` pointing at a uid with no user document, and
            // because every release path reads the DRIVER's record to find their
            // car, no code in the app could ever free it again.
            //
            // Found in production on 2026-08-14: one of three cars in the fleet
            // was permanently `in_use`, held by a deleted account, which is a
            // third of the fleet gone with nothing reporting it.
            //
            // Released BEFORE the commit and in the same batch, so the car cannot
            // be orphaned by a crash between deleting the user and freeing it.
            const releasedVehicleIds = await releaseVehiclesHeldBy(db, batch, uid);

            await batch.commit();
            deletedFirestoreCount++;

            if (releasedVehicleIds.length > 0) {
                console.log(`[adminDeleteUser] Released ${releasedVehicleIds.join(', ')} held by ${uid}`);
            }

            // Delete Firebase Authentication Account via Admin SDK
            try {
                await admin.auth().deleteUser(uid);
                deletedAuthCount++;
            } catch (authErr: any) {
                // If user doesn't exist in Auth or was already deleted, log warning
                console.warn(`Auth deletion warning for UID ${uid}:`, authErr.message || authErr);
            }

            // Log Audit Entry. writeAuditLog swallows its own failures, for the
            // same reason the try/catch here did: the account is already gone, and
            // failing the call now would report a deletion that did happen as an
            // error.
            await writeAuditLog(db, {
                action: 'user.delete',
                actorUid: callerUid,
                actorName: String(callerData?.name || 'Manager'),
                targetCollection: 'users',
                targetDocumentId: uid,
                summary: releasedVehicleIds.length > 0
                    ? `Permanently deleted the user's profile and sign-in account, and released ${releasedVehicleIds.length} vehicle(s) they held`
                    : 'Permanently deleted the user\'s profile and sign-in account',
                details: {
                    deletedAuthAccount: deletedAuthCount > 0,
                    // Named so a manager reading the log can tell which car came
                    // back, rather than discovering it changed status for no
                    // recorded reason.
                    releasedVehicleIds,
                },
            });
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
