"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVER_VEHICLE_CLEARED = exports.VEHICLE_RELEASED = void 0;
exports.writeVehicleState = writeVehicleState;
exports.releaseVehiclesHeldBy = releaseVehiclesHeldBy;
exports.resolveVehicleHolder = resolveVehicleHolder;
exports.resolveDriverVehicleId = resolveDriverVehicleId;
/** Both halves of the mirror. Order is irrelevant; the write is batched. */
const FLEET_COLLECTIONS = ['vehicles', 'cars'];
/**
 * Stage the same vehicle state into both collections.
 *
 * `set` with merge rather than `update`, because a vehicle created before the
 * mirror existed may be present in only one of them, and `update` on a missing
 * document fails the whole batch.
 */
function writeVehicleState(batch, db, vehicleId, state, now = new Date()) {
    // `updatedAt` is stamped HERE rather than at each call site, because the
    // idle-vehicle sweep decides how long a car has been held from it. The client
    // picker (hooks/useVehicles.ts) has always written it; the server paths did
    // not, so a car taken by globalAssignDriver carried whatever timestamp the
    // pick had left — and a field that is only sometimes written is worse than one
    // that is never written, because the sweep would trust it.
    const stamped = Object.assign(Object.assign({}, state), { updatedAt: now.toISOString() });
    for (const name of FLEET_COLLECTIONS) {
        batch.set(db.collection(name).doc(vehicleId), stamped, { merge: true });
    }
}
/**
 * Stage the release of every vehicle recorded as held by this driver.
 *
 * Exists because the release paths all start from the DRIVER's record — they read
 * `currentVehicleId` and release that one car. When the driver's record is being
 * deleted, or has already gone, there is nothing to read, and the vehicle keeps
 * `assignedDriverId` pointing at a uid that no longer resolves. No code path in
 * the app can then free it: `adminDeleteUser` deleted `vehicles/{uid}` and
 * `cars/{uid}`, keys no real vehicle uses, so the car simply stayed `in_use` for
 * ever. That is exactly how a three-car fleet reached zero available cars.
 *
 * So this works the other way round — from the vehicle side, by query.
 *
 * BOTH collections are queried and the ids unioned, rather than trusting
 * `vehicles` alone. The mirror agrees today, but the entire reason this file
 * exists is that it has drifted before, and a half-released car is the failure
 * this function is meant to end.
 *
 * Returns the vehicle ids staged, so the caller can audit what it freed.
 */
async function releaseVehiclesHeldBy(db, batch, uid) {
    const ids = new Set();
    for (const name of FLEET_COLLECTIONS) {
        const snap = await db.collection(name).where('assignedDriverId', '==', uid).get();
        snap.docs.forEach(doc => ids.add(doc.id));
    }
    for (const id of ids) {
        writeVehicleState(batch, db, id, exports.VEHICLE_RELEASED);
    }
    return Array.from(ids);
}
/** The state every release path should write. Named so the call sites read as intent. */
exports.VEHICLE_RELEASED = {
    status: 'available',
    assignedDriverId: null,
    assignedDriverName: null,
};
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
function resolveVehicleHolder(vehicle) {
    var _a, _b;
    return (_b = (_a = vehicle === null || vehicle === void 0 ? void 0 : vehicle.assignedDriverId) !== null && _a !== void 0 ? _a : vehicle === null || vehicle === void 0 ? void 0 : vehicle.currentDriverId) !== null && _b !== void 0 ? _b : null;
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
function resolveDriverVehicleId(driver) {
    var _a, _b;
    return (_b = (_a = driver === null || driver === void 0 ? void 0 : driver.currentVehicleId) !== null && _a !== void 0 ? _a : driver === null || driver === void 0 ? void 0 : driver.currentCarId) !== null && _b !== void 0 ? _b : null;
}
/**
 * Clearing a driver's vehicle means clearing BOTH names, always. Spreading this
 * rather than setting currentVehicleId alone is the whole fix for the stale
 * fallback above.
 */
exports.DRIVER_VEHICLE_CLEARED = {
    currentVehicleId: null,
    currentCarId: null,
};
//# sourceMappingURL=fleet.js.map