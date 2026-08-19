// ============================================
// HTTP FUNCTION: sarthiArrived
// The Sarthi is outside the rider's house.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedDriver } from '../utils/authz';
import { notifyStudentSarthiArrived, tokensOf } from '../utils/notifications';

/**
 * Announce arrival at ONE stop.
 *
 * ── Why this is its own callable, not part of startRide ──
 *
 * `startRide` requires `status === 'assigned'` and fans out over
 * `where('status','==','assigned')` for the whole car. Arrival is per-stop and
 * must do neither.
 *
 * ── Why `in_progress -> arriving` and not before the start ──
 *
 * `components/RideStatus.tsx` labels `arriving` as a pre-departure stage, which
 * invites putting it before `startRide`. Do not. `startRide` refuses anything
 * that is not `assigned`, so a Sarthi who announced arrival first would find
 * Start refusing outright — and on a grouped car the one document he had
 * flipped would be silently skipped by that fan-out while the rest started.
 * That is a real dispatch break.
 *
 * After the start it also matches reality: "Accept & Start" means pulling away,
 * so `in_progress` is en route and `arriving` is "I am outside your house". And
 * it needs no edits anywhere else — `completeRide`, `driverDoneForToday`,
 * `managerReleaseVehicle` and `releaseIdleVehicles` all already list `arriving`
 * among the statuses they treat as active.
 *
 * ── Who is told ──
 *
 * ONLY `ride.studentId`. `globalAssignDriver` writes `students` — the entire
 * car's roster — onto EVERY one of the car's ride documents, so iterating
 * `ride.students` here would tell all four riders that the Sarthi is outside
 * their house. The per-stop rider is `studentId`. There is a test named for
 * this.
 */
export const sarthiArrived = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { rideId } = data ?? {};
    if (!rideId) {
        throw new functions.https.HttpsError('invalid-argument', 'rideId is required');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    // Stricter than startRide/completeRide, which check ownership only. Being
    // the named driver on a document is not the same as still being an approved
    // one — see the note at the top of utils/authz.ts.
    await assertApprovedDriver(db, uid, 'mark arrival');

    const rideRef = db.collection('rides').doc(rideId);

    const outcome = await db.runTransaction(async tx => {
        const snap = await tx.get(rideRef);
        if (!snap.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }
        const ride = snap.data() ?? {};

        // Both shapes: the client-side manager assignment writes `driver.id`
        // while the dispatcher writes `driverId`, and completeRide already
        // accepts either. Checking only one would refuse a legitimate Sarthi.
        const assigned = ride.driverId || ride.driver?.id;
        if (assigned !== uid) {
            throw new functions.https.HttpsError(
                'permission-denied', 'Only the assigned Sarthi can mark arrival');
        }

        // Idempotent on `arrivedAt`, NOT on status: completeRide can move the
        // document off `arriving`, and a second tap after that must not
        // re-announce.
        if (ride.arrivedAt) return { alreadyArrived: true, studentId: null as string | null };

        if (ride.status !== 'in_progress') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `A ride in '${ride.status}' cannot be marked as arrived`,
            );
        }

        tx.update(rideRef, { status: 'arriving', arrivedAt: new Date().toISOString() });
        return { alreadyArrived: false, studentId: (ride.studentId as string) ?? null };
    });

    if (outcome.alreadyArrived) return { success: true, alreadyArrived: true };

    // After the commit, in its own try/catch. A push failure must never fail the
    // state change — the Sarthi is standing outside a house.
    if (outcome.studentId) {
        try {
            const riderDoc = await db.collection('users').doc(outcome.studentId).get();
            await notifyStudentSarthiArrived(tokensOf(outcome.studentId, riderDoc.data()));
        } catch (err) {
            console.error('[sarthiArrived] notification failed (non-fatal):', err);
        }
    }

    return { success: true, alreadyArrived: false };
});
