import { describe, it, expect } from 'vitest';
import {
    writeVehicleState,
    resolveVehicleHolder,
    resolveDriverVehicleId,
    VEHICLE_RELEASED,
    DRIVER_VEHICLE_CLEARED,
} from './fleet';

/** Minimal stand-ins for the Admin SDK batch and db. */
function fakeBatch() {
    const sets: Array<{ path: string; data: any; merge: boolean }> = [];
    const batch = {
        set: (ref: any, data: any, opts?: any) =>
            sets.push({ path: ref.path, data, merge: !!opts?.merge }),
    } as any;
    const db = {
        collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    } as any;
    return { batch, db, sets };
}

describe('writeVehicleState', () => {
    it('writes to both halves of the mirror', () => {
        // The fleet lives in `vehicles` AND `cars`. globalAssignDriver wrote only
        // `cars`, so useAvailableVehicles — which queries `vehicles` where
        // status == 'available' — kept offering a car that was already in use.
        const { batch, db, sets } = fakeBatch();

        writeVehicleState(batch, db, 'veh_1', { status: 'in_use' });

        expect(sets.map(s => s.path).sort()).toEqual(['cars/veh_1', 'vehicles/veh_1']);
        expect(sets.every(s => s.data.status === 'in_use')).toBe(true);
    });

    it('merges, so a vehicle present in only one collection still writes', () => {
        const { batch, db, sets } = fakeBatch();

        writeVehicleState(batch, db, 'veh_1', VEHICLE_RELEASED);

        expect(sets.every(s => s.merge)).toBe(true);
    });

    it('releases the driver fields, not just the status', () => {
        const { batch, db, sets } = fakeBatch();

        writeVehicleState(batch, db, 'veh_1', VEHICLE_RELEASED);

        for (const s of sets) {
            expect(s.data.status).toBe('available');
            expect(s.data.assignedDriverId).toBeNull();
            expect(s.data.assignedDriverName).toBeNull();
        }
    });
});

describe('resolveVehicleHolder', () => {
    it('reads assignedDriverId, which is what every writer actually sets', () => {
        // The guard in globalAssignDriver read `currentDriverId` — a name that
        // only exists on the CLIENT type, after useVehicles maps it on read. No
        // document has ever carried it, so the "assigned to another driver"
        // check compared undefined to a uid and passed every time.
        expect(resolveVehicleHolder({ assignedDriverId: 'driver_a' })).toBe('driver_a');
    });

    it('still resolves a hand-edited currentDriverId, so the check fails closed', () => {
        expect(resolveVehicleHolder({ currentDriverId: 'driver_b' })).toBe('driver_b');
    });

    it('prefers assignedDriverId when a document carries both', () => {
        expect(resolveVehicleHolder({
            assignedDriverId: 'driver_a', currentDriverId: 'stale_b',
        })).toBe('driver_a');
    });

    it('returns null for a free vehicle', () => {
        expect(resolveVehicleHolder({ status: 'available' })).toBeNull();
        expect(resolveVehicleHolder({ assignedDriverId: null })).toBeNull();
        expect(resolveVehicleHolder(undefined)).toBeNull();
    });
});

describe('resolveDriverVehicleId', () => {
    it('prefers currentVehicleId, the name the client writes', () => {
        expect(resolveDriverVehicleId({
            currentVehicleId: 'veh_new', currentCarId: 'veh_old',
        })).toBe('veh_new');
    });

    it('falls back to the legacy currentCarId', () => {
        expect(resolveDriverVehicleId({ currentCarId: 'veh_old' })).toBe('veh_old');
    });

    it('returns null once the driver holds nothing', () => {
        // The stale-fallback bug: releaseAssignment cleared currentVehicleId and
        // left currentCarId set, so driverDoneForToday resolved a car the driver
        // no longer had — and released it out from under whoever did. Both names
        // are cleared together now, so this resolves to nothing.
        expect(resolveDriverVehicleId({ ...DRIVER_VEHICLE_CLEARED })).toBeNull();
        expect(resolveDriverVehicleId({})).toBeNull();
    });

    it('DRIVER_VEHICLE_CLEARED nulls both names', () => {
        expect(DRIVER_VEHICLE_CLEARED.currentVehicleId).toBeNull();
        expect(DRIVER_VEHICLE_CLEARED.currentCarId).toBeNull();
    });
});
