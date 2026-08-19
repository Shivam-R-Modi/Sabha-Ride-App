// ============================================
// HTTP FUNCTION: managerReleaseVehicle
// A manager hands a stuck car back to the fleet.
// ============================================

/**
 * The escape hatch the fleet never had.
 *
 * A vehicle becomes `in_use` the moment a driver picks it, and only a deliberate
 * `driverDoneForToday`, `completeRide` or `releaseAssignment` frees it. Every one
 * of those starts from the DRIVER. So when the driver stops without finishing —
 * closes the tab, loses signal, gets deleted, or is soft-released and simply
 * walks away — the car stays held and nobody but that driver can free it.
 *
 * A manager's only options were deleting and recreating the vehicle, or editing
 * the database by hand. Deleting is refused while the car is `in_use`, and
 * `VehicleForm`'s update branch drops `status`, so editing could not clear it
 * either. On 2026-08-14 that left a three-car fleet with zero available cars and
 * no way back through the UI.
 *
 * WHY THIS IS A CALLABLE AND NOT A CLIENT WRITE
 *
 * firestore.rules already lets a manager update `vehicles`, so a client could do
 * two of the three writes. It could not do them atomically, and it should not do
 * the third at all: freeing a car means clearing `currentVehicleId` on ANOTHER
 * user's document. Doing that from a browser means every manager's client holds
 * permission to rewrite other people's profiles, and a half-applied release is
 * precisely the split-brain state this whole area keeps producing.
 *
 * So: one batch, one authorisation check, one audit row.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertApprovedManager } from '../utils/authz';
import { writeAuditLog } from '../utils/audit';
import {
    writeVehicleState, resolveVehicleHolder, VEHICLE_RELEASED, DRIVER_VEHICLE_CLEARED,
} from '../utils/fleet';

/** A ride in any of these means the car is out on the road right now. */
const ACTIVE_RIDE_STATUSES = ['assigned', 'driver_en_route', 'arriving', 'in_progress'];

export const managerReleaseVehicle = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const vehicleId = typeof data?.vehicleId === 'string' ? data.vehicleId.trim() : '';
    if (!vehicleId) {
        throw new functions.https.HttpsError('invalid-argument', 'vehicleId is required');
    }

    const db = admin.firestore();
    const manager = await assertApprovedManager(db, context.auth.uid, 'release a vehicle');

    const vehicleSnap = await db.collection('vehicles').doc(vehicleId).get();
    // Fall back to `cars` so a vehicle recorded in only one half of the mirror can
    // still be freed. The mirror agrees today; the reason utils/fleet.ts exists is
    // that it has not always.
    const carSnap = vehicleSnap.exists
        ? null
        : await db.collection('cars').doc(vehicleId).get();

    const vehicle = vehicleSnap.exists ? vehicleSnap.data() : carSnap?.data();
    if (!vehicle) {
        throw new functions.https.HttpsError('not-found', 'Vehicle not found.');
    }

    const holder = resolveVehicleHolder(vehicle);

    // Refuse while passengers are aboard.
    //
    // Releasing mid-run makes the driver's screen disagree with the people in
    // their car, and the manager pressing this cannot see that from the fleet
    // list. Stranding a driver halfway through a Friday-night run with children
    // aboard is worse than a car stuck overnight, so this fails closed and says
    // what to do instead.
    if (holder) {
        const live = await db.collection('rides')
            .where('driverId', '==', holder)
            .where('status', 'in', ACTIVE_RIDE_STATUSES)
            .get();

        if (!live.empty) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${vehicle.assignedDriverName || 'That Sarthi'} is on a run with `
                + `${live.size} ride(s). Release their riders first, or wait until they finish.`,
            );
        }
    }

    const batch = db.batch();
    writeVehicleState(batch, db, vehicleId, VEHICLE_RELEASED);

    if (holder) {
        const holderRef = db.collection('users').doc(holder);
        const holderSnap = await holderRef.get();
        const held = holderSnap.data()?.currentVehicleId ?? holderSnap.data()?.currentCarId ?? null;

        // Only when they still hold THIS car. `update` rather than `set`, so a
        // deleted account is not resurrected as a stub, and a driver who has since
        // taken a different vehicle does not have that one cleared instead —
        // fixing one stuck car by creating another is not a fix.
        if (holderSnap.exists && held === vehicleId) {
            batch.update(holderRef, {
                ...DRIVER_VEHICLE_CLEARED,
                // The pointer goes too. A driver with no car cannot have an
                // active ride, and a dangling activeRideId is what made the
                // driver screen unreadable after a soft release.
                activeRideId: null,
                status: 'offline',
            });
        }
    }

    await batch.commit();

    // After the commit, and never allowed to fail it: a car freed without a log
    // is recoverable, a car left held because its own audit row was rejected is
    // the bug this function exists to remove. writeAuditLog swallows its own
    // errors for the same reason.
    await writeAuditLog(db, {
        action: 'doc.update',
        actorUid: context.auth.uid,
        actorName: String(manager?.name || 'Manager'),
        targetCollection: 'vehicles',
        targetDocumentId: vehicleId,
        summary: `Released ${vehicle.name || vehicleId} back to the fleet`
            + (vehicle.assignedDriverName ? `, held by ${vehicle.assignedDriverName}` : ''),
        details: {
            vehicleName: vehicle.name ?? null,
            previousHolder: holder,
            previousHolderName: vehicle.assignedDriverName ?? null,
        },
    });

    return { success: true, vehicleId, previousHolder: holder };
});
