/**
 * Moving one person between Bhulku and Sarthi, on one document.
 *
 * The defect this function exists to prevent is not a duplicate account — there
 * has only ever been one profile per person. It is a HALF-WRITTEN one. A user
 * document carries four role fields and different readers read different ones, so
 * setting `role: 'driver'` and leaving `roles: ['student']` produces somebody who
 * is a driver to firestore.rules' recordsRole() and invisible to the driver
 * picker. That is what the raw field editor has been able to do all along, and
 * `roles: ['manager']` at signup already shipped exactly this bug once.
 *
 * So the load-bearing test here is "all four fields move together", and the
 * second one is "`roles` is the GRANTED set". Everything else guards the two
 * things a role change drags behind it: the car, and the riders already on the
 * driver's sheet.
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
vi.mock('../utils/authz', async () => {
    const real = await vi.importActual<any>('../utils/authz');
    return {
        // The truth table itself is exercised by authz.test.ts; mocking only the
        // READ keeps this file about the role change. isApprovedManagerData stays
        // REAL, because "refuses a manager target" must test the actual predicate
        // and not a stub that agrees with the test.
        isApprovedManagerData: real.isApprovedManagerData,
        assertApprovedManager: (...a: any[]) => assertApprovedManager(...a as []),
    };
});

const rateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: (...a: any[]) => rateLimit(...a as []) }));

const auditRows: any[] = [];
vi.mock('../utils/audit', () => ({
    writeAuditLog: vi.fn(async (_db: any, entry: any) => { auditRows.push(entry); return null; }),
}));

import { managerSetUserRole } from './managerSetUserRole';

interface Recorder {
    sets: Array<{ path: string; data: any }>;
    updates: Array<{ path: string; data: any }>;
    committed: boolean;
}

/**
 * A chainable Firestore fake.
 *
 * `rides` is keyed by which field the query filtered on, because this function
 * asks two DIFFERENT ride questions — "is this person riding as a passenger"
 * (`studentId`) on promotion, and "is this person driving" (`driverId`) on
 * demotion. A fake that returned the same list for both would let a promotion
 * bug hide behind a demotion fixture.
 */
function makeDb(opts: {
    target?: Record<string, unknown> | null;
    ridesByDriver?: Array<{ id: string; data: Record<string, unknown> }>;
    ridesByStudent?: Array<{ id: string; data: Record<string, unknown> }>;
    heldVehicles?: string[];
}) {
    const recorder: Recorder = { sets: [], updates: [], committed: false };

    const collection = (name: string) => {
        const filters: Record<string, unknown> = {};
        const chain: any = {
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => ({
                    exists: opts.target !== null && opts.target !== undefined,
                    data: () => opts.target,
                }),
            }),
            where: (field: string, _op: string, value: unknown) => {
                filters[field] = value;
                return chain;
            },
            get: async () => {
                if (name === 'rides') {
                    const rows = 'driverId' in filters
                        ? (opts.ridesByDriver ?? [])
                        : (opts.ridesByStudent ?? []);
                    return {
                        empty: rows.length === 0,
                        size: rows.length,
                        docs: rows.map(r => ({ id: r.id, data: () => r.data })),
                    };
                }
                if (name === 'vehicles') {
                    const ids = opts.heldVehicles ?? [];
                    return { docs: ids.map(id => ({ id })) };
                }
                // `cars`, the other half of the fleet mirror.
                return { docs: [] };
            },
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

const run = (role: 'driver' | 'student', targetUserId = 'person_1', uid = 'manager_1') =>
    (managerSetUserRole as any)({ targetUserId, role }, { auth: { uid } });

const BHULKU = {
    name: 'Asha', accountStatus: 'approved',
    role: 'student', registeredRole: 'student', roles: ['student'], activeRole: 'student',
};

const SARTHI = {
    name: 'Nilesh', accountStatus: 'approved',
    role: 'driver', registeredRole: 'driver', roles: ['driver', 'student'], activeRole: 'driver',
};

const userWrite = (rec: Recorder) => rec.updates.find(w => w.path === 'users/person_1')?.data;

beforeEach(() => {
    vi.clearAllMocks();
    auditRows.length = 0;
    assertApprovedManager.mockResolvedValue({ name: 'Manager Meera' } as any);
    rateLimit.mockResolvedValue(undefined);
});

describe('managerSetUserRole — who may call it', () => {
    it('refuses an unauthenticated caller', async () => {
        makeDb({ target: BHULKU });
        await expect((managerSetUserRole as any)({ targetUserId: 'person_1', role: 'driver' }, {}))
            .rejects.toThrow(/authenticated/i);
    });

    it('refuses anyone who is not an approved manager', async () => {
        makeDb({ target: BHULKU });
        assertApprovedManager.mockRejectedValue(
            Object.assign(new Error('Only approved managers can change a person\'s role.'),
                { code: 'permission-denied' }) as any,
        );

        await expect(run('driver')).rejects.toThrow(/approved managers/i);
    });

    it('checks authority BEFORE spending the rate limit', async () => {
        // Otherwise a stranger hammering this endpoint exhausts a real manager's
        // allowance for them. Same ordering adminDeleteUser and the CSV export use.
        makeDb({ target: BHULKU });
        assertApprovedManager.mockRejectedValue(
            Object.assign(new Error('nope'), { code: 'permission-denied' }) as any,
        );

        await expect(run('driver')).rejects.toThrow();
        expect(rateLimit).not.toHaveBeenCalled();
    });

    it('is rate limited', async () => {
        makeDb({ target: BHULKU });
        await run('driver');
        expect(rateLimit).toHaveBeenCalledWith(
            'manager_1',
            expect.objectContaining({ functionName: 'managerSetUserRole' }),
        );
    });
});

describe('managerSetUserRole — arguments and preconditions', () => {
    it('requires a targetUserId', async () => {
        makeDb({ target: BHULKU });
        await expect((managerSetUserRole as any)({ role: 'driver' }, { auth: { uid: 'manager_1' } }))
            .rejects.toThrow(/targetUserId/);
    });

    it.each(['manager', 'admin', '', null, undefined])('refuses role %p', async (role) => {
        // 'manager' in particular: this endpoint must not become the manager
        // grant path, because it does not touch custom claims.
        makeDb({ target: BHULKU });
        await expect((managerSetUserRole as any)(
            { targetUserId: 'person_1', role }, { auth: { uid: 'manager_1' } },
        )).rejects.toThrow(/must be 'driver' or 'student'/);
    });

    it('refuses a target that does not exist', async () => {
        makeDb({ target: null });
        await expect(run('driver')).rejects.toThrow(/no longer exists/i);
    });

    it('refuses a manager target, in both directions', async () => {
        const MANAGER = {
            name: 'Meera', accountStatus: 'approved',
            role: 'manager', registeredRole: 'manager',
            roles: ['manager', 'driver', 'student'], activeRole: 'manager',
        };

        makeDb({ target: MANAGER });
        await expect(run('student')).rejects.toThrow(/invite path/);

        makeDb({ target: MANAGER });
        await expect(run('driver')).rejects.toThrow(/invite path/);
    });

    it('refuses a manager recorded ONLY in roles[]', async () => {
        // recordsRole() reads three fields, so a document carrying the manager
        // role in the array alone is still a manager. A check on `role` only would
        // silently rewrite them.
        makeDb({
            target: {
                name: 'Quiet Manager', accountStatus: 'approved',
                role: 'student', registeredRole: 'student', roles: ['manager'],
            },
        });
        await expect(run('driver')).rejects.toThrow(/invite path/);
    });

    it.each(['pending', 'rejected'])('refuses an account that is %s', async (accountStatus) => {
        makeDb({ target: { ...BHULKU, accountStatus } });
        await expect(run('driver')).rejects.toThrow(/Approve it first/);
    });

    it('writes nothing at all when it refuses', async () => {
        const rec = makeDb({ target: { ...BHULKU, accountStatus: 'pending' } });
        await expect(run('driver')).rejects.toThrow();

        expect(rec.updates).toEqual([]);
        expect(rec.sets).toEqual([]);
        expect(rec.committed).toBe(false);
    });

    it('writes no audit row when it refuses', async () => {
        makeDb({ target: { ...BHULKU, accountStatus: 'pending' } });
        await expect(run('driver')).rejects.toThrow();
        expect(auditRows).toEqual([]);
    });
});

describe('managerSetUserRole — all four role fields move together', () => {
    it('promotion writes role, registeredRole, roles AND activeRole', async () => {
        // THE defect. Any one of these left behind and the person is a Sarthi to
        // some readers and a Bhulku to others, with no field that settles it.
        const rec = makeDb({ target: BHULKU });
        await run('driver');

        expect(userWrite(rec)).toMatchObject({
            role: 'driver',
            registeredRole: 'driver',
            roles: ['driver', 'student'],
            activeRole: 'driver',
        });
    });

    it('demotion writes all four back', async () => {
        const rec = makeDb({ target: SARTHI });
        await run('student');

        expect(userWrite(rec)).toMatchObject({
            role: 'student',
            registeredRole: 'student',
            roles: ['student'],
            activeRole: 'student',
        });
    });

    it('writes roles as the GRANTED set, not the single role', async () => {
        // useAvailableDrivers queries `roles array-contains 'driver'`. Writing
        // ['driver'] would be consistent with no other writer in the app, and
        // writing ['manager'] once already made every manager invisible to that
        // very query.
        const rec = makeDb({ target: BHULKU });
        await run('driver');

        expect(userWrite(rec)!.roles).toEqual(['driver', 'student']);
    });

    it('REPAIRS a half-written document rather than calling it already done', async () => {
        // The state the raw field editor could always produce: driver by `role`,
        // Bhulku by `roles`. hasRecordedRole() says "already a driver" and would
        // short-circuit the one call that fixes it.
        const rec = makeDb({
            target: {
                name: 'Half', accountStatus: 'approved',
                role: 'driver', registeredRole: 'student', roles: ['student'], activeRole: 'student',
            },
        });

        const result = await run('driver');

        expect(result.changed).toBe(true);
        expect(userWrite(rec)).toMatchObject({
            role: 'driver', registeredRole: 'driver',
            roles: ['driver', 'student'], activeRole: 'driver',
        });
    });

    it('is a no-op, not an error, when the document already says exactly this', async () => {
        const rec = makeDb({ target: SARTHI });
        const result = await run('driver');

        expect(result).toMatchObject({ success: true, changed: false, reason: 'already' });
        expect(rec.committed).toBe(false);
        expect(auditRows).toEqual([]);
    });
});

describe('managerSetUserRole — promotion does not disturb a ride in progress', () => {
    it('refuses while the person is riding as a passenger', async () => {
        // `status` on this document is overloaded — DriverStatus for a Sarthi,
        // StudentStatus for a Bhulku. Writing 'offline' over a live 'in_progress'
        // takes them off their own driver's roster mid-journey.
        makeDb({
            target: BHULKU,
            ridesByStudent: [{ id: 'ride_9', data: { status: 'in_progress', studentId: 'person_1' } }],
        });

        await expect(run('driver')).rejects.toThrow(/on a ride right now/i);
    });

    it('allows it while they merely have an unanswered request', async () => {
        // A `requested` ride is not in ACTIVE_RIDE_STATUSES, so the query does not
        // return it. A Sarthi is still a Bhulku, so the pending lift survives —
        // that is the point of changing the role in place.
        const rec = makeDb({ target: BHULKU, ridesByStudent: [] });
        await run('driver');
        expect(rec.committed).toBe(true);
    });

    it('leaves the new Sarthi off shift', async () => {
        const rec = makeDb({ target: BHULKU });
        await run('driver');
        expect(userWrite(rec)!.status).toBe('offline');
    });

    it('does not touch the fleet', async () => {
        const rec = makeDb({ target: BHULKU, heldVehicles: ['veh_1'] });
        await run('driver');
        // Becoming a Sarthi does not hand anybody a car, and a Bhulku holding one
        // is a broken document this function is not the place to interpret.
        expect(rec.sets).toEqual([]);
    });
});

describe('managerSetUserRole — demotion never strands a run', () => {
    it.each(['driver_en_route', 'arriving', 'in_progress'])(
        'refuses while a run is %s',
        async (status) => {
            makeDb({
                target: SARTHI,
                ridesByDriver: [{ id: 'ride_1', data: { status, studentName: 'Asha' } }],
            });

            await expect(run('student')).rejects.toThrow(/out on a run/i);
        },
    );

    it('names the riders in the refusal, so the manager knows who to wait for', async () => {
        makeDb({
            target: SARTHI,
            ridesByDriver: [
                { id: 'ride_1', data: { status: 'in_progress', studentName: 'Asha' } },
                { id: 'ride_2', data: { status: 'in_progress', studentName: 'Ravi' } },
            ],
        });

        await expect(run('student')).rejects.toThrow(/Asha, Ravi/);
    });

    it('writes nothing when it refuses mid-run', async () => {
        const rec = makeDb({
            target: SARTHI,
            ridesByDriver: [{ id: 'ride_1', data: { status: 'in_progress' } }],
        });

        await expect(run('student')).rejects.toThrow();
        expect(rec.updates).toEqual([]);
        expect(rec.sets).toEqual([]);
        expect(rec.committed).toBe(false);
        expect(auditRows).toEqual([]);
    });

    it('releases rides that are still only ASSIGNED, and their riders', async () => {
        // Nobody has moved yet: an assigned ride is a proposal on a screen. Handing
        // it back is strictly better than leaving riders attached to a driver who
        // has ceased to be one — that is a ride nothing will ever complete.
        const rec = makeDb({
            target: SARTHI,
            ridesByDriver: [{
                id: 'ride_1',
                data: {
                    status: 'assigned', rideType: 'home-to-sabha',
                    students: [{ id: 'stu_1' }, { id: 'stu_2' }],
                },
            }],
        });

        await run('student');

        const rideWrite = rec.updates.find(w => w.path === 'rides/ride_1')!.data;
        expect(rideWrite.status).toBe('requested');
        expect(rideWrite.driverId).toBeNull();

        expect(rec.updates.find(w => w.path === 'users/stu_1')!.data)
            .toMatchObject({ status: 'waiting_for_pickup', currentRideId: null });
        expect(rec.updates.find(w => w.path === 'users/stu_2')!.data)
            .toMatchObject({ status: 'waiting_for_pickup', currentRideId: null });
    });

    it('sends a drop-off carload back to waiting_for_dropoff, not waiting_for_pickup', async () => {
        const rec = makeDb({
            target: SARTHI,
            ridesByDriver: [{
                id: 'ride_1',
                data: { status: 'assigned', rideType: 'sabha-to-home', students: [{ id: 'stu_1' }] },
            }],
        });

        await run('student');

        expect(rec.updates.find(w => w.path === 'users/stu_1')!.data.status)
            .toBe('waiting_for_dropoff');
    });

    it('frees the car, in both halves of the fleet mirror', async () => {
        // Every release path reads the DRIVER's record to find their car. Once the
        // record stops saying driver, nothing in the app can free it — that is how
        // a three-car fleet reached zero available cars.
        const rec = makeDb({ target: SARTHI, heldVehicles: ['veh_1'] });

        await run('student');

        expect(rec.sets.map(s => s.path).sort()).toEqual(['cars/veh_1', 'vehicles/veh_1']);
        expect(rec.sets[0]!.data).toMatchObject({ status: 'available', assignedDriverId: null });
        expect(userWrite(rec)).toMatchObject({ currentVehicleId: null, currentCarId: null });
    });

    it('keeps the day\'s tally', async () => {
        // Zeroing a volunteer's counters as a side effect of an unrelated change is
        // the bug the old releaseVehicle had, and the manager's board reads them.
        const rec = makeDb({
            target: { ...SARTHI, ridesCompletedToday: 3, totalStudentsToday: 11 },
        });

        await run('student');

        expect(userWrite(rec)).not.toHaveProperty('ridesCompletedToday');
        expect(userWrite(rec)).not.toHaveProperty('totalStudentsToday');
    });
});

describe('managerSetUserRole — the request, and the audit trail', () => {
    it('clears a pending upgrade request when it grants it', async () => {
        const rec = makeDb({
            target: { ...BHULKU, roleUpgrade: { status: 'pending', requestedAt: '2026-08-24T10:00:00Z' } },
        });

        await run('driver');

        expect(userWrite(rec)!.roleUpgrade).toBeNull();
    });

    it('does not add a roleUpgrade field to somebody who never asked', async () => {
        const rec = makeDb({ target: BHULKU });
        await run('driver');
        expect(userWrite(rec)).not.toHaveProperty('roleUpgrade');
    });

    it('records the change, naming the actor and both roles', async () => {
        makeDb({ target: BHULKU });
        await run('driver');

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: 'role.change',
            actorUid: 'manager_1',
            actorName: 'Manager Meera',
            targetCollection: 'users',
            targetDocumentId: 'person_1',
        });
        expect(auditRows[0].summary).toMatch(/Asha/);
        expect(auditRows[0].details).toMatchObject({ from: ['student'], to: 'driver' });
    });

    it('records what a demotion took away, not just the role', async () => {
        // A car that changed status and riders that moved queues, with nothing
        // saying why, is the shape of an unexplained outage on a Friday evening.
        makeDb({
            target: SARTHI,
            heldVehicles: ['veh_1'],
            ridesByDriver: [{
                id: 'ride_1',
                data: { status: 'assigned', rideType: 'home-to-sabha', students: [{ id: 'stu_1' }] },
            }],
        });

        await run('student');

        expect(auditRows[0].details).toMatchObject({
            releasedRideIds: ['ride_1'],
            releasedRiderIds: ['stu_1'],
            releasedVehicleIds: ['veh_1'],
        });
    });

    it('records the row AFTER the change, never instead of it', async () => {
        const rec = makeDb({ target: BHULKU });
        await run('driver');
        expect(rec.committed).toBe(true);
        expect(auditRows).toHaveLength(1);
    });
});
