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

const DRIVER = { name: 'Asha', currentVehicleId: 'veh_1', activeRideId: null };

function makeDb(opts: {
    /** Rides in `requested`, i.e. the queue. */
    queue?: Array<Record<string, unknown>>;
    /** Vehicles held, i.e. who is on shift. */
    held?: Array<Record<string, unknown>>;
    eventId?: string | null;
}) {
    const writes: Array<{ path: string; data: any }> = [];
    const queue = opts.queue ?? [];
    const held = opts.held ?? [];
    const eventId = opts.eventId === undefined ? '2026-08-14' : opts.eventId;

    const collection = (name: string) => {
        // The two `where` calls this handler makes are distinguished by the
        // collection, which is all the fake needs to keep them apart.
        const chain: any = {
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => ({
                    exists: true,
                    data: () => {
                        if (name === 'system') return { eventId };
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

describe('driverDoneForToday — the warning path', () => {
    const WAITING = [{ status: 'requested', eventId: '2026-08-14' }];
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
            queue: [{ status: 'requested', eventId: '2026-08-07' }],
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
