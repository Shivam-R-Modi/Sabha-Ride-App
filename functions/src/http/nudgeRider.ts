// ============================================
// HTTP FUNCTION: nudgeRider
// The Sarthi is outside and nobody has come out.
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedDriver } from '../utils/authz';
import { notifyStudentSarthiWaiting, tokensOf } from '../utils/notifications';
import { checkRateLimit } from '../utils/rateLimiter';

/**
 * Ask one rider again.
 *
 * The policy the owner chose for a Bhulku who is not there is **wait and nudge**:
 * the roster never changes mid-run, nothing is re-dispatched, and no seat goes
 * back into the pool while a car is parked outside a house. So the Sarthi needs
 * two things while they wait — this, and the phone button beside it, which
 * already existed.
 *
 * `sarthiArrived` already announces arrival once, automatically. This is the
 * button for afterwards, which is the only genuinely new capability here.
 *
 * FIXED TEXT, NO FREE INPUT
 * -------------------------
 * A new driver-to-child message path on an app holding minors' names, phone
 * numbers and addresses. `managerBroadcast` forces its title "because a free-text
 * title could impersonate a system push"; here the whole message is fixed and
 * anything else in the payload is ignored. Nothing a caller sends is echoed to a
 * phone.
 *
 * ONE RIDER, NOT THE CAR
 * ----------------------
 * `globalAssignDriver` copies the whole car's roster onto EVERY ride document, so
 * `ride.students` is not "who this stop is for". The rider is named explicitly and
 * checked against the roster, which also lets the Sarthi nudge the third Bhulku
 * rather than only whoever `studentId` happens to be.
 *
 * A COOLDOWN PER RIDER
 * --------------------
 * Recorded on the ride at `nudges.<uid>`, not on the caller. `checkRateLimit` is
 * keyed by caller and function, so on its own it would let four late riders eat
 * each other's allowance — while the thing actually worth preventing is twenty
 * buzzes on one child's phone. The shared limiter stays as a backstop, and it
 * fails open by design, which is another reason not to rest the per-child
 * protection on it.
 */

/** How long before the same rider may be nudged again. */
export const NUDGE_COOLDOWN_MS = 60_000;

/** Statuses where somebody is genuinely waiting to be collected. */
const NUDGEABLE_STATUSES = ['in_progress', 'arriving'];

/**
 * Firebase uids, and nothing that could steer a field path somewhere else —
 * the cooldown is written to `nudges.<id>`, so a dot in the id would land in a
 * different field entirely.
 */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const nudgeRider = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { rideId, studentId } = data ?? {};
    if (!rideId || typeof rideId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'rideId is required');
    }
    if (typeof studentId !== 'string' || !UID_PATTERN.test(studentId)) {
        throw new functions.https.HttpsError('invalid-argument', 'a valid studentId is required');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;

    // Before the ride is read, so nothing is fetched for a caller with no
    // business here. Being the named driver on a document is not the same as
    // still being an approved one.
    await assertApprovedDriver(db, uid, 'nudge a rider');
    await checkRateLimit(uid, {
        maxRequests: 60,
        windowMs: 60 * 60 * 1000,
        functionName: 'nudgeRider',
    });

    const rideRef = db.collection('rides').doc(rideId);

    // In a transaction, because the check and the stamp are the cooldown. Two
    // taps a few milliseconds apart — a Sarthi's thumb on a cold morning — would
    // otherwise both read "no recent nudge" and both send, which is precisely
    // the double buzz this exists to prevent.
    const recipients = await db.runTransaction(async tx => {
        const snap = await tx.get(rideRef);
        if (!snap.exists) {
            throw new functions.https.HttpsError('not-found', 'Ride not found');
        }
        const ride = snap.data() ?? {};

        // Both shapes: the manager console writes `driver.id`, the dispatcher
        // writes `driverId`, and completeRide already accepts either.
        const assigned = ride.driverId || ride.driver?.id;
        if (assigned !== uid) {
            throw new functions.https.HttpsError(
                'permission-denied', 'Only the assigned Sarthi can nudge a rider on this run');
        }

        if (!NUDGEABLE_STATUSES.includes(ride.status)) {
            throw new functions.https.HttpsError(
                'failed-precondition', `Nobody is waiting on a ride in '${ride.status}'`);
        }

        const roster: string[] = [
            ...(typeof ride.studentId === 'string' ? [ride.studentId] : []),
            ...(Array.isArray(ride.students) ? ride.students.map((s: any) => s?.id) : []),
        ].filter((id: unknown): id is string => typeof id === 'string' && id !== '');

        if (!roster.includes(studentId)) {
            throw new functions.https.HttpsError(
                'permission-denied', 'That rider is not on this run');
        }

        const lastNudge = Date.parse(ride.nudges?.[studentId] ?? '');
        if (Number.isFinite(lastNudge)) {
            const remainingMs = lastNudge + NUDGE_COOLDOWN_MS - Date.now();
            if (remainingMs > 0) {
                throw new functions.https.HttpsError(
                    'resource-exhausted',
                    `Already nudged. You can nudge again in ${Math.ceil(remainingMs / 1000)} seconds.`,
                );
            }
        }

        // The devices are read BEFORE the nudge is recorded: a rider with no
        // phone registered has not been told anything, so burning the cooldown
        // on them would leave the Sarthi tapping a button that can never do
        // anything. They are told to phone instead, and the phone button is
        // right beside it.
        const riderSnap = await tx.get(db.collection('users').doc(studentId));
        const found = tokensOf(studentId, riderSnap.data());
        if (found.length === 0) return [];

        tx.update(rideRef, { [`nudges.${studentId}`]: new Date().toISOString() });
        return found;
    });

    if (recipients.length === 0) {
        console.log(`[nudgeRider] ${studentId} has no registered device`);
        return { success: true, delivered: 0 };
    }

    // After the commit, and non-fatal: the Sarthi is sitting outside a house, and
    // a failed push must not read as a failed action they should retry twenty
    // times. `delivered` tells them what actually happened.
    try {
        const result = await notifyStudentSarthiWaiting(recipients);
        return { success: true, delivered: result.delivered };
    } catch (err) {
        console.error('[nudgeRider] notification failed (non-fatal):', err);
        return { success: true, delivered: 0 };
    }
});
