import { describe, it, expect } from 'vitest';
import {
    writeVehicleState,
    resolveVehicleHolder,
    resolveDriverVehicleId,
    VEHICLE_RELEASED,
    DRIVER_VEHICLE_CLEARED,
    releaseVehiclesHeldBy,
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

/**
 * `updatedAt`, stamped in one place.
 *
 * The idle-vehicle sweep decides how long a car has been held from this field.
 * The client picker has always written it; the server paths did not, so a car
 * taken by globalAssignDriver kept whatever timestamp the pick had left. A field
 * the sweep trusts and only some writers set is worse than one nobody sets.
 */
describe('writeVehicleState — updatedAt', () => {
    it('stamps updatedAt on both halves', () => {
        const { batch, db, sets } = fakeBatch();
        const now = new Date('2026-08-14T18:00:00.000Z');

        writeVehicleState(batch, db, 'veh_1', { status: 'in_use' }, now);

        expect(sets).toHaveLength(2);
        for (const s of sets) {
            expect(s.data.updatedAt).toBe('2026-08-14T18:00:00.000Z');
        }
    });

    it('does not let a caller\'s own updatedAt win, so the field cannot go stale', () => {
        const { batch, db, sets } = fakeBatch();
        const now = new Date('2026-08-14T18:00:00.000Z');

        writeVehicleState(batch, db, 'veh_1', {
            status: 'in_use',
            updatedAt: '2020-01-01T00:00:00.000Z',
        }, now);

        for (const s of sets) {
            expect(s.data.updatedAt).toBe('2026-08-14T18:00:00.000Z');
        }
    });
});

/** A fake db that answers `where('assignedDriverId','==',uid)` per collection. */
function fakeQueryDb(holdings: Record<string, string[]>) {
    const sets: Array<{ path: string; data: any }> = [];
    const batch = { set: (ref: any, data: any) => sets.push({ path: ref.path, data }) } as any;
    const db = {
        collection: (name: string) => ({
            doc: (id: string) => ({ path: `${name}/${id}` }),
            where: (_field: string, _op: string, _value: unknown) => ({
                get: async () => ({
                    docs: (holdings[name] ?? []).map(id => ({ id })),
                }),
            }),
        }),
    } as any;
    return { batch, db, sets };
}

/**
 * Releasing from the VEHICLE side.
 *
 * Every other release path starts from the driver's record and frees the one car
 * `currentVehicleId` names. When the driver's record is being deleted there is
 * nothing to read — and adminDeleteUser's `delete(vehicles/{uid})` matched a key
 * no vehicle uses, so deleting an account silently released nothing and left a
 * car held by a uid that no longer resolved. A third of the production fleet was
 * lost that way, unrecoverably.
 */
describe('releaseVehiclesHeldBy', () => {
    it('releases the car a driver holds', async () => {
        const { batch, db, sets } = fakeQueryDb({ vehicles: ['veh_1'], cars: ['veh_1'] });

        const ids = await releaseVehiclesHeldBy(db, batch, 'driver_1');

        expect(ids).toEqual(['veh_1']);
        expect(sets.map(s => s.path).sort()).toEqual(['cars/veh_1', 'vehicles/veh_1']);
        for (const s of sets) {
            expect(s.data.status).toBe('available');
            expect(s.data.assignedDriverId).toBeNull();
        }
    });

    it('finds a car recorded in only one half of the mirror', async () => {
        // The mirror agrees today, but this file exists because it has drifted
        // before. Trusting `vehicles` alone would leave the `cars` copy in_use,
        // and globalAssignDriver reads `cars`.
        const { batch, db, sets } = fakeQueryDb({ vehicles: [], cars: ['veh_9'] });

        const ids = await releaseVehiclesHeldBy(db, batch, 'driver_1');

        expect(ids).toEqual(['veh_9']);
        expect(sets.map(s => s.path).sort()).toEqual(['cars/veh_9', 'vehicles/veh_9']);
    });

    it('does not release the same vehicle twice when both halves agree', async () => {
        const { batch, db, sets } = fakeQueryDb({ vehicles: ['veh_1'], cars: ['veh_1'] });

        const ids = await releaseVehiclesHeldBy(db, batch, 'driver_1');

        expect(ids).toHaveLength(1);
        expect(sets).toHaveLength(2); // one per collection, not four
    });

    it('releases every car when a driver somehow holds more than one', async () => {
        const { batch, db } = fakeQueryDb({ vehicles: ['veh_1', 'veh_2'], cars: ['veh_1'] });

        const ids = await releaseVehiclesHeldBy(db, batch, 'driver_1');

        expect(ids.sort()).toEqual(['veh_1', 'veh_2']);
    });

    it('writes nothing when the driver holds no car', async () => {
        const { batch, db, sets } = fakeQueryDb({ vehicles: [], cars: [] });

        const ids = await releaseVehiclesHeldBy(db, batch, 'driver_1');

        expect(ids).toEqual([]);
        expect(sets).toEqual([]);
    });
});
