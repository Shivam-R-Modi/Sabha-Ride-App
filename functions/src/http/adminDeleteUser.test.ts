/**
 * Deleting a user must hand back the car they were holding.
 *
 * THE BUG THESE EXIST FOR
 * -----------------------
 * adminDeleteUser used to do this:
 *
 *     batch.delete(db.collection('vehicles').doc(uid));
 *     batch.delete(db.collection('cars').doc(uid));
 *
 * Documents keyed by the USER's uid. Vehicles have their own ids, so on any real
 * fleet those two lines matched nothing and quietly did NOTHING — while looking
 * exactly like vehicle cleanup to every reader since.
 *
 * The consequence was not cosmetic. `assignedDriverId` kept pointing at a uid with
 * no user document, and because every release path in the app starts from the
 * DRIVER's record to find their car, no code could ever free it again. Found in
 * production on 2026-08-14: one of three cars permanently `in_use`, held by a
 * deleted account, for nine days. A third of the fleet, gone, with nothing
 * reporting it.
 *
 * `releaseVehiclesHeldBy` has its own unit tests in utils/fleet.test.ts. These
 * assert something different and equally necessary: that adminDeleteUser actually
 * CALLS it. A correct helper nobody invokes is the same bug in a new place, and it
 * is the failure mode this codebase keeps having to remove.
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
    return {
        https: {
            onCall: (handler: any) => handler,
            HttpsError: FakeHttpsError,
        },
    };
});

const deleteUserMock = vi.fn(async () => undefined);

vi.mock('firebase-admin', () => ({
    firestore: () => db,
    auth: () => ({ deleteUser: deleteUserMock }),
}));

vi.mock('../utils/authz', () => ({
    assertApprovedManager: vi.fn(async () => ({ name: 'Manager Meera' })),
}));

// Deleting a user is irreversible and takes a batch, so the handler is rate
// limited. Stubbed to a no-op here: these cases are about the fleet cleanup, and
// the limit itself is covered in sensitiveEndpointLimits.test.ts.
vi.mock('../utils/rateLimiter', () => ({
    checkRateLimit: vi.fn(async () => undefined),
}));

const auditRows: any[] = [];
vi.mock('../utils/audit', () => ({
    writeAuditLog: vi.fn(async (_db: any, entry: any) => { auditRows.push(entry); return null; }),
}));

import { adminDeleteUser } from './adminDeleteUser';
import { assertApprovedManager } from '../utils/authz';

interface Recorder {
    deletes: string[];
    sets: Array<{ path: string; data: any }>;
    commits: number;
}

/**
 * `holdings` maps collection name to the vehicle ids that collection reports as
 * held by the queried uid — i.e. what `where('assignedDriverId','==',uid)` returns.
 */
function makeDb(holdings: Record<string, string[]>): { db: any; recorder: Recorder } {
    const recorder: Recorder = { deletes: [], sets: [], commits: 0 };

    const collection = (name: string) => ({
        doc: (id: string) => ({ path: `${name}/${id}` }),
        where: () => ({
            get: async () => ({ docs: (holdings[name] ?? []).map(id => ({ id })) }),
        }),
    });

    return {
        db: {
            collection,
            batch: () => ({
                delete: (ref: any) => recorder.deletes.push(ref.path),
                set: (ref: any, data: any) => recorder.sets.push({ path: ref.path, data }),
                update: () => undefined,
                commit: async () => { recorder.commits++; },
            }),
        },
        recorder,
    };
}

const run = async (holdings: Record<string, string[]>, targetUserId = 'driver_1') => {
    const made = makeDb(holdings);
    db = made.db;
    const result = await (adminDeleteUser as any)(
        { targetUserId },
        { auth: { uid: 'manager_1' } },
    );
    return { result, recorder: made.recorder };
};

beforeEach(() => {
    vi.clearAllMocks();
    auditRows.length = 0;
});

describe('adminDeleteUser — the car comes back', () => {
    it('releases a vehicle the deleted user was holding', async () => {
        const { recorder } = await run({ vehicles: ['veh_1'], cars: ['veh_1'] });

        const released = recorder.sets.filter(s => s.data?.status === 'available');
        expect(released.map(s => s.path).sort()).toEqual(['cars/veh_1', 'vehicles/veh_1']);
    });

    it('clears the dangling assignedDriverId, not just the status', async () => {
        // Leaving the uid on the document is how the orphan became invisible: the
        // car read as taken by someone who no longer existed.
        const { recorder } = await run({ vehicles: ['veh_1'], cars: ['veh_1'] });

        for (const s of recorder.sets.filter(x => x.data?.status === 'available')) {
            expect(s.data.assignedDriverId).toBeNull();
            expect(s.data.assignedDriverName).toBeNull();
        }
    });

    it('does NOT delete the vehicle document itself', async () => {
        // The old code deleted `vehicles/{uid}`. If a vehicle ever were keyed by a
        // driver uid, that would destroy a car because its driver left.
        const { recorder } = await run({ vehicles: ['veh_1'], cars: ['veh_1'] });

        expect(recorder.deletes).not.toContain('vehicles/veh_1');
        expect(recorder.deletes).not.toContain('cars/veh_1');
    });

    it('no longer deletes the uid-keyed documents that never matched anything', async () => {
        const { recorder } = await run({ vehicles: ['veh_1'], cars: ['veh_1'] });

        expect(recorder.deletes).not.toContain('vehicles/driver_1');
        expect(recorder.deletes).not.toContain('cars/driver_1');
    });

    it('still deletes the profile and its mirrors', async () => {
        const { recorder } = await run({ vehicles: [], cars: [] });

        expect(recorder.deletes.sort()).toEqual([
            'drivers/driver_1', 'students/driver_1', 'users/driver_1',
        ]);
    });

    it('finds a car recorded in only one half of the mirror', async () => {
        const { recorder } = await run({ vehicles: [], cars: ['veh_9'] });

        const released = recorder.sets.filter(s => s.data?.status === 'available');
        expect(released.map(s => s.path).sort()).toEqual(['cars/veh_9', 'vehicles/veh_9']);
    });

    it('releases in the same batch as the deletion, so a crash cannot orphan the car', async () => {
        const { recorder } = await run({ vehicles: ['veh_1'], cars: ['veh_1'] });

        // One commit: the user going away and the car coming back are atomic.
        expect(recorder.commits).toBe(1);
    });

    it('touches no vehicle when the user held none', async () => {
        const { recorder } = await run({ vehicles: [], cars: [] });

        expect(recorder.sets.filter(s => s.data?.status === 'available')).toEqual([]);
    });

    it('deletes the sign-in account too', async () => {
        await run({ vehicles: [], cars: [] });

        expect(deleteUserMock).toHaveBeenCalledWith('driver_1');
    });
});

describe('adminDeleteUser — the audit trail says what was freed', () => {
    it('names the released vehicles', async () => {
        await run({ vehicles: ['veh_1'], cars: ['veh_1'] });

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0].details.releasedVehicleIds).toEqual(['veh_1']);
    });

    it('says so in the human summary, so a status change is never unexplained', async () => {
        await run({ vehicles: ['veh_1'], cars: ['veh_1'] });

        expect(auditRows[0].summary).toMatch(/released 1 vehicle/i);
    });

    it('keeps the plain summary when nothing was held', async () => {
        await run({ vehicles: [], cars: [] });

        expect(auditRows[0].summary).not.toMatch(/released/i);
        expect(auditRows[0].details.releasedVehicleIds).toEqual([]);
    });
});

describe('adminDeleteUser — who may call it', () => {
    it('goes through assertApprovedManager', async () => {
        await run({ vehicles: [], cars: [] });

        expect(assertApprovedManager).toHaveBeenCalledWith(
            expect.anything(), 'manager_1', 'delete users',
        );
    });

    it('refuses an unauthenticated caller', async () => {
        db = makeDb({}).db;
        await expect((adminDeleteUser as any)({ targetUserId: 'x' }, {}))
            .rejects.toThrow(/authenticated/i);
    });

    it('refuses a call naming nobody', async () => {
        db = makeDb({}).db;
        await expect((adminDeleteUser as any)({}, { auth: { uid: 'manager_1' } }))
            .rejects.toThrow(/required/i);
    });
});
