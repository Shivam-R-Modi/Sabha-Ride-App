// ============================================
// HTTP FUNCTION: managerSetUserRole
// A manager moves a person between Bhulku and Sarthi, in place.
// ============================================

/**
 * The control `adminDeleteUser` has been telling managers to use since it was
 * written, and which did not exist.
 *
 *     "That account is a manager. Remove the manager role first, then delete it."
 *     "Demotion is the intended route: clear the role, then delete if wanted."
 *                                          — adminDeleteUser.ts:82, :95
 *
 * There was no route. The only way to change anybody's role was the raw field
 * editor in the Records tab, and that is where the "duplicate profile" this
 * function was asked to prevent actually comes from.
 *
 * WHY A HALF-WRITE LOOKS LIKE A SECOND ACCOUNT
 * -------------------------------------------
 * A user document carries FOUR role fields and different readers read different
 * ones (src/roles.ts has the table):
 *
 *   role            ManagerReports, the Records role filter
 *   registeredRole  the two pending-approval queues
 *   roles[]         useAvailableDrivers — the driver picker
 *   activeRole      a UI preference, authority nowhere
 *
 * `DocumentEditorModal` edits them ONE AT A TIME. Set `role: 'driver'` and leave
 * `roles: ['student']` and the person is a driver to firestore.rules' recordsRole()
 * and invisible to the driver picker: one human, two disagreeing identities, and
 * no single field you can read to find out which is true. That exact shape has
 * already shipped once — `roles: ['manager']` at signup made every manager
 * invisible to `useAvailableDrivers`, so the manager's "assign to any driver"
 * control could only ever say "No available drivers found".
 *
 * So the fix is not a new document anywhere. There is exactly ONE profile per
 * person, `users/{uid}` — `students/` and `drivers/` are dead, `allow read, write:
 * if false`. The fix is that all four fields move together, in one batch, on that
 * one document, from here.
 *
 * WHY A CALLABLE, WHEN firestore.rules ALREADY LETS A MANAGER DO THIS
 * ------------------------------------------------------------------
 * Same argument as managerReleaseVehicle, and for the same three reasons.
 * Atomicity: a demotion rewrites four role fields, frees a car in two mirrored
 * collections, and hands several rides plus their riders back to the pool — a
 * dozen writes across three collections that must not half-apply. Authority: it
 * writes OTHER people's documents, and doing that from a browser means every
 * manager's client holds permission to rewrite anybody's profile. And the audit
 * row: the four role fields carry no history, so this row is the only record that
 * a person's access changed, on an app holding children's addresses.
 *
 * firestore.rules is narrowed alongside this so the browser can no longer write
 * role fields at all. This is the only path.
 *
 * DELIBERATELY NOT IN SCOPE: THE MANAGER ROLE
 * -------------------------------------------
 * Manager targets are refused outright. Demoting a manager means clearing the
 * `mgr` custom claim and revoking their refresh tokens, and guarding against
 * removing the last manager — `isManagerForRead()` honours a stale claim for up
 * to an hour, and a congregation that demotes its only manager cannot appoint a
 * replacement, because creating an invite requires being one. That gap is already
 * written down at hooks/useUsers.ts:183. Refusing is better than half-doing it.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager, isApprovedManagerData } from '../utils/authz';
import { checkRateLimit } from '../utils/rateLimiter';
import { writeAuditLog } from '../utils/audit';
import {
    recordedRoles, hasRecordedRole, roleFieldsFor, statesRoleConsistently,
} from '../utils/roles';
import { releaseVehiclesHeldBy, DRIVER_VEHICLE_CLEARED } from '../utils/fleet';
import {
    releaseRideToPool, ACTIVE_RIDE_STATUSES, UNDERWAY_RIDE_STATUSES,
} from '../utils/assignments';
import { UserRole } from '../types';

/** The only two roles this function will set. Manager is refused; see the header. */
type SettableRole = 'driver' | 'student';

/** What each role reads as to a person. formatRole() is the client's copy. */
const LABEL: Record<UserRole, string> = {
    manager: 'Manager',
    driver: 'Sarthi',
    student: 'Bhulku',
};

export const managerSetUserRole = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const db = admin.firestore();
    const callerUid = context.auth.uid;

    // Authority BEFORE the rate limit, so a stranger cannot spend a real
    // manager's allowance. Same order as adminDeleteUser and the export.
    const manager = await assertApprovedManager(db, callerUid, "change a person's role");

    await checkRateLimit(callerUid, {
        maxRequests: 30,
        windowMs: 60 * 60 * 1000,
        functionName: 'managerSetUserRole',
    });

    const targetUserId = typeof data?.targetUserId === 'string' ? data.targetUserId.trim() : '';
    if (!targetUserId) {
        throw new functions.https.HttpsError('invalid-argument', 'targetUserId is required');
    }

    const role = data?.role;
    if (role !== 'driver' && role !== 'student') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            "role must be 'driver' or 'student'.",
        );
    }

    const targetRef = db.collection('users').doc(targetUserId);
    const targetSnap = await targetRef.get();
    const target = targetSnap.data();

    if (!targetSnap.exists || !target) {
        throw new functions.https.HttpsError('not-found', 'That account no longer exists.');
    }

    const name = String(target.name || 'That person');
    const from = recordedRoles(target);

    // A manager is refused in BOTH directions — promoting one to Sarthi would
    // demote them, and demoting one needs the claim work this does not do.
    // `hasRecordedRole` as well as `isApprovedManagerData`, so an unapproved
    // self-declared manager document is caught too rather than being quietly
    // rewritten.
    if (isApprovedManagerData(target) || hasRecordedRole(target, 'manager')) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `${name} is a manager. Manager roles are granted and removed through `
            + 'the invite path, not here.',
        );
    }

    // A pending or rejected account must not be handed driving duties, and
    // demoting one changes nothing they can reach. Approve or delete it instead.
    if (target.accountStatus !== 'approved') {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `${name}'s account is ${String(target.accountStatus || 'not approved')}. `
            + 'Approve it first, in People.',
        );
    }

    if (statesRoleConsistently(target, role)) {
        // Not an error. Two managers tapping the same button, or a double tap on a
        // slow phone, is an ordinary thing — and throwing here would report a
        // correct end state as a failure.
        return { success: true, changed: false, reason: 'already', role, name };
    }

    const batch = db.batch();
    const now = new Date();
    const update: Record<string, unknown> = { ...roleFieldsFor(role) };

    let releasedRideIds: string[] = [];
    let releasedRiderIds: string[] = [];
    let releasedVehicleIds: string[] = [];

    if (role === 'driver') {
        // PROMOTION.
        //
        // Refused while they are mid-ride as a PASSENGER, because `status` on this
        // document is overloaded: it holds a DriverStatus for a Sarthi and a
        // StudentStatus for a Bhulku (types.ts:75-93). Writing `offline` over a
        // live `in_progress` would take them off their own driver's roster while
        // they are sitting in the car.
        //
        // A `requested` ride is deliberately fine and left alone. A Sarthi is
        // still a Bhulku — the hierarchy grants it — so a pending lift home
        // survives the promotion, which is the whole point of doing this in place.
        const riding = await db.collection('rides')
            .where('studentId', '==', targetUserId)
            .where('status', 'in', ACTIVE_RIDE_STATUSES)
            .get();

        if (!riding.empty) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${name} is on a ride right now. Try again once that run has finished.`,
            );
        }

        // Off shift, not on it. Becoming a Sarthi does not put somebody on the
        // road; picking a car does, and they have not.
        update.status = 'offline';
    } else {
        // DEMOTION.
        //
        // Refuse once the run has STARTED. Children may be in the car, and the
        // manager pressing this cannot see that from a table of names. Same shape
        // and the same reasoning as managerReleaseVehicle: fail closed, and say
        // what to do instead.
        const live = await db.collection('rides')
            .where('driverId', '==', targetUserId)
            .where('status', 'in', ACTIVE_RIDE_STATUSES)
            .get();

        const underway = live.docs.filter(
            d => (UNDERWAY_RIDE_STATUSES as readonly string[]).includes(String(d.data()?.status)),
        );

        if (underway.length > 0) {
            const riders = underway
                .map(d => d.data()?.studentName)
                .filter(Boolean)
                .join(', ');
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${name} is out on a run with ${underway.length} ride(s)`
                + `${riders ? ` — ${riders}` : ''}. Riders may be in the car. `
                + 'Wait for the run to finish, or release it first.',
            );
        }

        // Everything left is still `assigned`: a proposal on a screen that nobody
        // has acted on. Hand each carload back to the pool so the riders are
        // dispatchable again instead of stranded against a driver who has ceased
        // to be one.
        for (const rideDoc of live.docs) {
            releasedRiderIds = releasedRiderIds.concat(
                releaseRideToPool(batch, db, rideDoc.id, rideDoc.data(), now),
            );
            releasedRideIds.push(rideDoc.id);
        }

        // The car goes back to the fleet. Skipping this is exactly how a
        // three-car fleet reached zero available cars on 2026-08-14: every
        // release path reads the DRIVER's record to find their car, so once the
        // record stops saying "driver" nothing in the app can free it again.
        // Queried from the vehicle side for that reason.
        releasedVehicleIds = await releaseVehiclesHeldBy(db, batch, targetUserId);

        Object.assign(update, DRIVER_VEHICLE_CLEARED, {
            status: 'offline',
            activeRideId: null,
            currentVehicleName: null,
            currentVehiclePlate: null,
            carModel: null,
            carColor: null,
            plateNumber: null,
            assignedStudentIds: [],
        });

        // NOT cleared: ridesCompletedToday, totalStudentsToday,
        // totalDistanceToday. Those are what this person actually did today, and
        // the manager's board reads them. Zeroing a volunteer's tally as a side
        // effect of an unrelated change is the bug the old releaseVehicle had.
    }

    // The request, if there was one, is answered by the change itself.
    //
    // `null` rather than a field delete: the rules have to validate what a rider
    // may write here, and `== null` is one clause where distinguishing an absent
    // field from a deleted one is three.
    if (target.roleUpgrade) {
        update.roleUpgrade = null;
    }

    batch.update(targetRef, update);
    await batch.commit();

    // After the commit, and never allowed to fail it. writeAuditLog swallows its
    // own errors: a role change that half-happened because its own audit row was
    // rejected would be worse than an unlogged one.
    await writeAuditLog(db, {
        action: 'role.change',
        actorUid: callerUid,
        actorName: String(manager?.name || 'Manager'),
        targetCollection: 'users',
        targetDocumentId: targetUserId,
        summary: `${role === 'driver' ? 'Promoted' : 'Returned'} ${name} `
            + `from ${LABEL[from[0] ?? 'student']} to ${LABEL[role]}`
            + (releasedRideIds.length > 0
                ? `, releasing ${releasedRideIds.length} assigned ride(s)`
                : '')
            + (releasedVehicleIds.length > 0
                ? ` and ${releasedVehicleIds.length} vehicle(s)`
                : ''),
        details: {
            from,
            to: role,
            // Named, so a manager reading the log can tell whose evening was
            // changed rather than discovering it for no recorded reason.
            releasedRideIds,
            releasedRiderIds,
            releasedVehicleIds,
            viaRequest: !!target.roleUpgrade,
        },
    });

    console.log(`[managerSetUserRole] ${callerUid} set ${targetUserId} to ${role}`);

    return {
        success: true,
        changed: true,
        role,
        name,
        releasedRideIds,
        releasedRiderIds,
        releasedVehicleIds,
    };
});
