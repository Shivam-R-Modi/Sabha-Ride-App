/**
 * One vehicle, two collections, three field names.
 *
 * The fleet is mirrored across `vehicles` and `cars`. The client reads and
 * writes both (hooks/useVehicles.ts), but the Cloud Functions did not:
 * globalAssignDriver wrote only `cars`, while completeRide and
 * releaseAssignment released only `vehicles`. Each half-write leaves the other
 * collection stating the opposite, and the two failures point in opposite
 * directions:
 *
 *   - Assign writes `cars/{id}` in_use but leaves `vehicles/{id}` available.
 *     useAvailableVehicles queries `vehicles` where status == 'available', so
 *     the car a driver is already using stays in the picker for everyone else.
 *   - Complete releases `vehicles/{id}` but leaves `cars/{id}` in_use.
 *     globalAssignDriver reads `cars`, so the vehicle looks permanently taken
 *     to the assigner.
 *
 * Combined with the field-name mismatch below, that is the "two drivers, one
 * car" path: driver A is assigned car X (cars in_use, vehicles untouched),
 * driver B picks X out of the still-available list, and the guard meant to stop
 * it reads a field nothing writes.
 *
 * Merging the collections is a data migration and belongs with the tenancy work
 * in the roadmap. Until then, every server-side fleet write goes through here,
 * so the two copies cannot drift.
 */

import * as admin from 'firebase-admin';

/** Both halves of the mirror. Order is irrelevant; the write is batched. */
const FLEET_COLLECTIONS = ['vehicles', 'cars'] as const;

/**
 * Stage the same vehicle state into both collections.
 *
 * `set` with merge rather than `update`, because a vehicle created before the
 * mirror existed may be present in only one of them, and `update` on a missing
 * document fails the whole batch.
 */
export function writeVehicleState(
    batch: admin.firestore.WriteBatch,
    db: admin.firestore.Firestore,
    vehicleId: string,
    state: Record<string, unknown>,
): void {
    for (const name of FLEET_COLLECTIONS) {
        batch.set(db.collection(name).doc(vehicleId), state, { merge: true });
    }
}

/** The state every release path should write. Named so the call sites read as intent. */
export const VEHICLE_RELEASED = {
    status: 'available',
    assignedDriverId: null,
    assignedDriverName: null,
} as const;

/**
 * Which driver currently holds this vehicle, if any.
 *
 * Every writer — client and server — sets `assignedDriverId`. The guard in
 * globalAssignDriver read `currentDriverId`, which is the name the CLIENT type
 * uses after useVehicles maps it on read; no document has ever carried it. So
 * the "vehicle is assigned to another driver" check compared undefined against
 * a uid and passed every time.
 *
 * `currentDriverId` is still accepted here in case any hand-edited document
 * carries it. This check exists to fail closed.
 */
export function resolveVehicleHolder(vehicle: any): string | null {
    return vehicle?.assignedDriverId ?? vehicle?.currentDriverId ?? null;
}

/**
 * Which vehicle this driver holds, if any.
 *
 * `currentVehicleId` is canonical — it is what the client writes and what the
 * driver dashboard gates "Assign Me" on. `currentCarId` is the server's older
 * name for the same thing, and the two diverged: releaseAssignment and
 * completeRide cleared only `currentVehicleId`, so a stale `currentCarId`
 * survived and driverDoneForToday would fall back to it and release a car
 * another driver had since taken.
 *
 * Every write path now clears both, so the fallback can no longer be stale —
 * it only ever resolves documents written before this change.
 */
export function resolveDriverVehicleId(driver: any): string | null {
    return driver?.currentVehicleId ?? driver?.currentCarId ?? null;
}

/**
 * Clearing a driver's vehicle means clearing BOTH names, always. Spreading this
 * rather than setting currentVehicleId alone is the whole fix for the stale
 * fallback above.
 */
export const DRIVER_VEHICLE_CLEARED = {
    currentVehicleId: null,
    currentCarId: null,
} as const;
