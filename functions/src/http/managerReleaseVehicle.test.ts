/**
 * The manager's escape hatch for a stuck car.
 *
 * A vehicle goes `in_use` the moment a driver picks it, and only that driver
 * finishing frees it. When they stop without finishing — close the tab, lose
 * signal, get deleted, or get soft-released and walk away — the car stays held
 * and no other path can free it: delete is refused while `in_use`, and editing
 * does not touch status. On 2026-08-14 that left a three-car fleet with zero
 * available cars and no way back through the UI.
 *
 * The one rule that outranks all of this: **a car with passengers aboard is
 * never released.** A manager pressing Release in a list cannot see that the
 * driver is mid-run, so the server refuses instead of trusting the caller.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});

vi.mock('firebase-admin', () => ({ firestore: () => db }));

const assertApprovedManager = vi.fn(async () => ({ name: 'Manager Meera' }));
vi.mock('../utils/authz', () => ({ assertApprovedManager: (...a: any[]) => assertApprovedManager(...a as []) }));

const auditRows: any[] = [];
vi.mock('../utils/audit', () => ({
    writeAuditLog: vi.fn(async (_db: any, entry: any) => { auditRows.push(entry); return null; }),
}));

import { managerReleaseVehicle } from './managerReleaseVehicle';

interface Recorder {
    sets: Array<{ path: string; data: any }>;
    updates: Array<{ path: string; data: any }>;
    committed: boolean;
}

function makeDb(opts: {
    vehicle?: Record<string, unknown> | null;
    holder?: Record<string, unknown> | null;
    liveRides?: number;
}) {
    const recorder: Recorder = { sets: [], updates: [], committed: false };
    const snap = (exists: boolean, data?: any) => ({ exists, data: () => data });

    const collection = (name: string) => {
        const chain: any = {
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => {
                    if (name === 'vehicles' || name === 'cars') {
                        return snap(opts.vehicle !== null && opts.vehicle !== undefined, opts.vehicle);
                    }
                    return snap(opts.holder !== null && opts.holder !== undefined, opts.holder);
                },
            }),
            where: () => chain,
            get: async () => ({ empty: (opts.liveRides ?? 0) === 0, size: opts.liveRides ?? 0 }),
        };
        return chain;
    };

    db = {
        collection,
        batch: () => ({
            set: (ref: any, data: any) => recorder.sets.push({ path: ref.path, data }),
            update: (ref: any, data: any) => recorder.updates.push({ path: ref.path, data }),
            commit: async () => { recorder.committed = true; },
        }),
    };
    return recorder;
}

const run = (vehicleId = 'veh_1', uid = 'manager_1') =>
    (managerReleaseVehicle as any)({ vehicleId }, { auth: { uid } });

const HELD = { name: 'Car3', status: 'in_use', assignedDriverId: 'driver_1', assignedDriverName: 'Tonny Stark' };

beforeEach(() => {
    vi.clearAllMocks();
    auditRows.length = 0;
    assertApprovedManager.mockResolvedValue({ name: 'Manager Meera' } as any);
});

describe('managerReleaseVehicle — who may call it', () => {
    it('refuses an unauthenticated caller', async () => {
        makeDb({ vehicle: HELD });
        await expect((managerReleaseVehicle as any)({ vehicleId: 'veh_1' }, {}))
            .rejects.toThrow(/authenticated/i);
    });

    it('goes through assertApprovedManager', async () => {
        makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1' } });
        await run();
        expect(assertApprovedManager).toHaveBeenCalledWith(
            expect.anything(), 'manager_1', 'release a vehicle',
        );
    });

    it('refuses when that check throws — a revoked manager cannot free cars', async () => {
        makeDb({ vehicle: HELD });
        assertApprovedManager.mockRejectedValueOnce(new Error('Only approved managers can release a vehicle.'));
        await expect(run()).rejects.toThrow(/approved managers/i);
    });

    it('requires a vehicleId', async () => {
        makeDb({ vehicle: HELD });
        await expect((managerReleaseVehicle as any)({}, { auth: { uid: 'manager_1' } }))
            .rejects.toThrow(/vehicleId is required/i);
    });

    it('reports a vehicle that does not exist', async () => {
        makeDb({ vehicle: null });
        await expect(run()).rejects.toThrow(/not found/i);
    });
});

describe('managerReleaseVehicle — never takes a car off a live run', () => {
    it('refuses while the holder has active rides', async () => {
        makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1' }, liveRides: 3 });

        await expect(run()).rejects.toThrow(/on a run with 3 ride/i);
    });

    it('names the driver so the manager knows who to talk to', async () => {
        makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1' }, liveRides: 1 });

        await expect(run()).rejects.toThrow(/Tonny Stark/);
    });

    it('writes nothing at all when it refuses', async () => {
        const rec = makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1' }, liveRides: 1 });

        await expect(run()).rejects.toThrow();

        expect(rec.sets).toEqual([]);
        expect(rec.updates).toEqual([]);
        expect(rec.committed).toBe(false);
    });
});

describe('managerReleaseVehicle — the release itself', () => {
    it('frees the car in BOTH collections', async () => {
        const rec = makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1' } });

        await run();

        expect(rec.sets.map(s => s.path).sort()).toEqual(['cars/veh_1', 'vehicles/veh_1']);
        for (const s of rec.sets) {
            expect(s.data.status).toBe('available');
            expect(s.data.assignedDriverId).toBeNull();
            expect(s.data.assignedDriverName).toBeNull();
        }
    });

    it('clears the holder\'s vehicle and their dangling ride pointer', async () => {
        const rec = makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1', activeRideId: 'ride_9' } });

        await run();

        const holderWrite = rec.updates.find(u => u.path === 'users/driver_1')!;
        expect(holderWrite.data.currentVehicleId).toBeNull();
        expect(holderWrite.data.currentCarId).toBeNull();
        expect(holderWrite.data.activeRideId).toBeNull();
    });

    it('does NOT touch a driver who has since taken a different car', async () => {
        // Fixing one stuck car by stranding another is not a fix.
        const rec = makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_OTHER' } });

        await run();

        expect(rec.updates.find(u => u.path === 'users/driver_1')).toBeUndefined();
        // The car itself is still freed.
        expect(rec.sets).toHaveLength(2);
    });

    it('frees a car whose holder no longer has an account', async () => {
        // The orphan case: assignedDriverId pointing at a deleted uid. No
        // driver-side path can ever reach this car.
        const rec = makeDb({ vehicle: HELD, holder: null });

        await run();

        expect(rec.sets).toHaveLength(2);
        // `update` on a missing doc would fail the batch; nothing is written there.
        expect(rec.updates.find(u => u.path === 'users/driver_1')).toBeUndefined();
    });

    it('frees a car with no holder recorded at all', async () => {
        const rec = makeDb({ vehicle: { name: 'Car1', status: 'in_use' } });

        await run();

        expect(rec.sets).toHaveLength(2);
        expect(rec.committed).toBe(true);
    });

    it('is a no-op-safe call on an already available car', async () => {
        const rec = makeDb({ vehicle: { name: 'Car2', status: 'available' } });

        await run();

        expect(rec.committed).toBe(true);
        for (const s of rec.sets) expect(s.data.status).toBe('available');
    });
});

describe('managerReleaseVehicle — the audit trail', () => {
    it('records who released what, and from whom', async () => {
        makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1' } });

        await run();

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].actorName).toBe('Manager Meera');
        expect(auditRows[0].targetDocumentId).toBe('veh_1');
        expect(auditRows[0].summary).toMatch(/Car3/);
        expect(auditRows[0].summary).toMatch(/Tonny Stark/);
        expect(auditRows[0].details.previousHolder).toBe('driver_1');
    });

    it('writes no audit row when the release was refused', async () => {
        makeDb({ vehicle: HELD, holder: { currentVehicleId: 'veh_1' }, liveRides: 2 });

        await expect(run()).rejects.toThrow();

        expect(auditRows).toEqual([]);
    });
});
