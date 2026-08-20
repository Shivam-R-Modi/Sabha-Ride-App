/**
 * The last driver out should know somebody is still waiting.
 *
 * Measured in production on 2026-08-14: both drivers tapped "Done for today"
 * within four minutes of each other, then two riders tapped "Ready to leave".
 * Nothing on any screen said there was no longer anyone who could collect them.
 *
 * WARN, NEVER BLOCK. A volunteer is always allowed to go home — the handler
 * returns without releasing anything, the client asks, and a second call with
 * `acknowledgeWaiting` goes through. Turning this into a throw would make the
 * app refuse to let somebody stop driving, which is worse than the problem.
 *
 * The silence cases matter as much as the warning: a prompt that fires whenever
 * a queue exists becomes noise and gets tapped through unread, which is how a
 * real warning stops working.
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

import { driverDoneForToday, decideDoneWarning } from './driverDoneForToday';
import { isAssignableTo } from './globalAssignDriver';

describe('decideDoneWarning — when to speak up', () => {
    it('warns when riders wait and nobody else is on shift', () => {
        expect(decideDoneWarning(2, 0)).toMatch(/2 riders are still waiting/);
        expect(decideDoneWarning(2, 0)).toMatch(/last driver on shift/);
    });

    it('says nothing when the queue is empty', () => {
        expect(decideDoneWarning(0, 0)).toBeNull();
    });

    it('says nothing while another driver could still take them', () => {
        // The ordinary case. Riders book ahead and drivers come and go.
        expect(decideDoneWarning(5, 1)).toBeNull();
        expect(decideDoneWarning(5, 3)).toBeNull();
    });

    it('reads correctly for a single rider', () => {
        expect(decideDoneWarning(1, 0)).toMatch(/1 rider is still waiting/);
    });

    it('spells out the consequence, not just the count', () => {
        expect(decideDoneWarning(1, 0)).toMatch(/nobody can pick them up tonight/i);
    });
});

// ── through the handler ──────────────────────────────────────────

// `accountStatus` and `roles` are part of the fixture, not an override, so every
// case here describes a Sarthi who is actually allowed to end a shift.
// driverDoneForToday now calls assertApprovedDriver — it used to check only that the
// caller was acting for themselves, which let a revoked account release a car.
const DRIVER = {
    name: 'Asha', currentVehicleId: 'veh_1', activeRideId: null,
    accountStatus: 'approved', roles: ['driver'],
};

function makeDb(opts: {
    /** Rides in `requested`, i.e. the queue. */
    queue?: Array<Record<string, unknown>>;
    /** Vehicles held, i.e. who is on shift. */
    held?: Array<Record<string, unknown>>;
    eventId?: string | null;
    /** The open window. Absent means no window is open at all. */
    rideType?: string | null;
}) {
    const writes: Array<{ path: string; data: any }> = [];
    const queue = opts.queue ?? [];
    const held = opts.held ?? [];
    const eventId = opts.eventId === undefined ? '2026-08-14' : opts.eventId;
    const rideType = opts.rideType === undefined ? 'home-to-sabha' : opts.rideType;

    const collection = (name: string) => {
        // The two `where` calls this handler makes are distinguished by the
        // collection, which is all the fake needs to keep them apart.
        const chain: any = {
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => ({
                    exists: true,
                    data: () => {
                        if (name === 'system') return rideType ? { eventId, rideType } : { eventId };
                        if (name === 'users') return DRIVER;
                        return undefined;
                    },
                }),
            }),
            where: (field: string, _op: string, value: unknown) => {
                if (name === 'rides' && field === 'status' && value !== 'requested') {
                    // The hard "still assigned to me" guard. Empty here so the
                    // warning path is what gets exercised.
                    return { ...chain, get: async () => ({ empty: true, size: 0, docs: [] }) };
                }
                return chain;
            },
            get: async () => {
                const rows = name === 'rides' ? queue : held;
                return {
                    empty: rows.length === 0,
                    size: rows.length,
                    docs: rows.map((d, i) => ({ id: `${name}${i}`, data: () => d })),
                };
            },
        };
        return chain;
    };

    db = {
        collection,
        batch: () => ({
            update: (ref: any, data: any) => writes.push({ path: ref.path, data }),
            set: (ref: any, data: any) => writes.push({ path: ref.path, data }),
            delete: () => undefined,
            commit: async () => undefined,
        }),
    };
    return writes;
}

const call = (data: any = {}) =>
    (driverDoneForToday as any)({ driverId: 'driver_1', ...data }, { auth: { uid: 'driver_1' } });

beforeEach(() => vi.clearAllMocks());

/**
 * A request as the client actually writes one.
 *
 * The rows here used to be `{ status, eventId }` and nothing else — no
 * coordinates, no studentId. That made every case in this file pass against a
 * shape the dispatcher would have refused, which is exactly how the count here
 * drifted from the count there. A fake that is easier to satisfy than production
 * is a test that cannot see the bug.
 */
const pickup = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    status: 'requested',
    eventId: '2026-08-14',
    studentId: 'stu_1',
    pickupLat: 42.36,
    pickupLng: -71.06,
    // No `rideType` field — this is what hooks/useRides.ts writes for a pickup.
    ...over,
});

describe('driverDoneForToday — the warning path', () => {
    const WAITING = [pickup()];
    const ONLY_ME = [{ assignedDriverId: 'driver_1' }];

    it('asks for confirmation instead of finishing', async () => {
        makeDb({ queue: WAITING, held: ONLY_ME });

        const result = await call();

        expect(result.needsConfirmation).toBe(true);
        expect(result.success).toBe(false);
        expect(result.waitingCount).toBe(1);
    });

    it('releases NOTHING while it is asking', async () => {
        // The whole point of returning rather than throwing is that the driver
        // can still say no — which is useless if the car is already gone.
        const writes = makeDb({ queue: WAITING, held: ONLY_ME });

        const result = await call();

        expect(writes).toEqual([]);
        expect(result.carReleased).toBe(false);
    });

    it('goes through once the driver acknowledges it', async () => {
        const writes = makeDb({ queue: WAITING, held: ONLY_ME });

        const result = await call({ acknowledgeWaiting: true });

        expect(result.success).toBe(true);
        expect(result.needsConfirmation).toBe(false);
        expect(writes.some(w => w.path.startsWith('vehicles/'))).toBe(true);
        expect(writes.find(w => w.path === 'users/driver_1')!.data.status).toBe('offline');
    });

    it('stays silent when another driver is still holding a car', async () => {
        const writes = makeDb({
            queue: WAITING,
            held: [{ assignedDriverId: 'driver_1' }, { assignedDriverId: 'driver_2' }],
        });

        const result = await call();

        expect(result.needsConfirmation).toBe(false);
        expect(result.success).toBe(true);
        expect(writes.length).toBeGreaterThan(0);
    });

    it('stays silent when nobody is waiting', async () => {
        makeDb({ queue: [], held: ONLY_ME });

        const result = await call();

        expect(result.success).toBe(true);
    });

    it('ignores requests belonging to a past gathering', async () => {
        // Stale rows must not raise a warning about riders who went home a week
        // ago — that is the residue expireStaleRequests clears.
        makeDb({
            queue: [pickup({ eventId: '2026-08-07' })],
            held: ONLY_ME,
            eventId: '2026-08-14',
        });

        const result = await call();

        expect(result.success).toBe(true);
    });

    it('counts one driver once, however many cars they hold', async () => {
        makeDb({
            queue: WAITING,
            held: [{ assignedDriverId: 'driver_2' }, { assignedDriverId: 'driver_2' }],
        });

        const result = await call();

        // driver_2 is still here, so no warning — and they are one driver, not two.
        expect(result.success).toBe(true);
    });

    // The hard "you still have riders assigned" guard, and the fact that it runs
    // BEFORE this warning, are covered in driverKeepsTheirCar.test.ts: its fake
    // returns assigned rides for every query, so a warning that fired first would
    // return instead of throwing and those cases would fail.
});

/**
 * The warning must count the SAME riders the dispatcher would hand out.
 *
 * This is the bug, as a suite. `surveyTheQueue` filtered by event key alone while
 * `isValidPendingRide` filtered by event key AND direction — so during a
 * drop-off run, a leftover pickup request counted here and was excluded there.
 *
 * Reported on 2026-08-17: "End my shift" said *1 rider is still waiting*, then
 * "Find my next riders" said *no one is left*. Two screens, one second apart,
 * contradicting each other with no way to tell which was right. And the warning
 * was the wrong one — staying could not have helped, because nothing in the pool
 * was dispatchable to anybody.
 *
 * The fix is that both now call one function, so these cases hold by
 * construction rather than by two lists being kept in step by hand.
 */
describe('the warning counts what dispatch would actually serve', () => {
    const ONLY_ME = [{ assignedDriverId: 'driver_1' }];
    const dropoff = (over: Record<string, unknown> = {}) =>
        pickup({ rideType: 'sabha-to-home', ...over });

    it('does NOT warn about a leftover pickup during a drop-off run', async () => {
        // The production failure. An unserved pickup outlives its window every
        // week, so before the fix this fired on every drop-off.
        makeDb({ queue: [pickup()], held: ONLY_ME, rideType: 'sabha-to-home' });

        const result = await call();

        expect(result.needsConfirmation).toBe(false);
        expect(result.success).toBe(true);
    });

    it('DOES warn about a drop-off request during a drop-off run', async () => {
        // The other half — the fix must not silence the real case, which is the
        // one the whole warning exists for.
        makeDb({ queue: [dropoff()], held: ONLY_ME, rideType: 'sabha-to-home' });

        const result = await call();

        expect(result.needsConfirmation).toBe(true);
        expect(result.waitingCount).toBe(1);
    });

    it('does NOT warn about a drop-off request during a pickup run', async () => {
        // Symmetric, and reachable: a rider can tap "ready to leave" before the
        // window has flipped.
        makeDb({ queue: [dropoff()], held: ONLY_ME, rideType: 'home-to-sabha' });

        const result = await call();

        expect(result.success).toBe(true);
    });

    it('does not warn about a request no driver could be routed to', async () => {
        // No usable pickup point, so the dispatcher refuses it. Warning "nobody
        // can pick them up" about a ride that staying would not fix teaches the
        // driver to tap the prompt through unread.
        makeDb({
            queue: [pickup({ pickupLat: 0, pickupLng: 0 })],
            held: ONLY_ME,
        });

        const result = await call();

        expect(result.success).toBe(true);
    });

    it('does not warn when no ride window is open', async () => {
        // globalAssignDriver throws outright in this state, so nothing in the
        // queue is dispatchable by anyone.
        makeDb({ queue: [pickup()], held: ONLY_ME, rideType: null });

        const result = await call();

        expect(result.success).toBe(true);
    });

    it('agrees with isAssignableTo row for row', () => {
        // The drift guard. If the two ever answer differently for the same row,
        // one of the two screens is lying to a driver — and this fails rather
        // than waiting for somebody to notice in the field.
        //
        // Asserts against isAssignableTo, which is what surveyTheQueue actually
        // calls. Left pointing at isValidPendingRide it would still pass while
        // guarding a function this file's subject no longer uses.
        const rows = [
            pickup(),
            dropoff(),
            pickup({ eventId: '2026-08-07' }),
            pickup({ pickupLat: 0, pickupLng: 0 }),
            pickup({ studentId: undefined }),
            dropoff({ rideType: 'sabha-to-Home' }),
            // The caller's own request. Dispatch refuses it, so the warning must
            // too — a driver is never their own passenger.
            dropoff({ studentId: 'driver_1' }),
        ];
        const accepted = rows.filter(r => isAssignableTo(r, 'driver_1', '2026-08-14', 'sabha-to-home'));

        // Exactly the one well-formed drop-off for this gathering, from somebody
        // other than the driver.
        expect(accepted).toHaveLength(1);
        expect(accepted[0]!.rideType).toBe('sabha-to-home');
        expect(accepted[0]!.studentId).toBe('stu_1');
    });

    it('does not warn a driver about their own waiting request', () => {
        // The contradiction this file exists to prevent, from a new cause: the
        // driver switched to Bhulku, asked for a ride, and came back. "End my
        // shift" would have said 1 rider is still waiting while "Find my next
        // riders" said no one is left — the same two lying screens as 2026-08-17.
        const own = [dropoff({ studentId: 'driver_1' })];
        expect(own.filter(r => isAssignableTo(r, 'driver_1', '2026-08-14', 'sabha-to-home')))
            .toHaveLength(0);
    });
});
