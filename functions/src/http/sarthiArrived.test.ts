/**
 * "I'm outside" — and who is told.
 *
 * THE DEFECT THIS FILE EXISTS TO PREVENT
 * --------------------------------------
 * `globalAssignDriver` writes `students` — the ENTIRE car's roster — onto every
 * one of that car's ride documents. Only `studentId` identifies the rider whose
 * house this particular stop is.
 *
 * So copying `startRide`'s `for (const student of ride.students)` loop into this
 * handler would tell all four riders in a carload that their Sarthi is outside
 * their house. Three of them would come out to an empty street. The test named
 * `tells only this stop's rider` fails the moment anyone does that.
 *
 * THE OTHER TRAP
 * --------------
 * `arriving` is written AFTER `in_progress`, never before. `startRide` refuses
 * anything that is not `assigned` and fans out over that same query, so an
 * earlier placement would make Start refuse outright and silently skip the one
 * flipped document in a grouped car.
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

const notifyArrived = vi.fn(async (..._args: any[]) => undefined);
vi.mock('../utils/notifications', () => ({
    notifyStudentSarthiArrived: (...a: any[]) => notifyArrived(...(a as [])),
    tokensOf: (uid: string, data: any) =>
        Object.keys(data?.fcmTokens ?? {}).map(token => ({ uid, token })),
}));

const approvedDriver = vi.fn(async () => ({}));
vi.mock('../utils/authz', () => ({
    assertApprovedDriver: (...a: any[]) => approvedDriver(...(a as [])),
}));

import { sarthiArrived } from './sarthiArrived';

const SARTHI = 'sarthi_1';
let updates: Array<{ path: string; data: any }>;

/** A car carrying three riders; this document is rider-a's stop. */
function makeDb(ride: any, users: Record<string, any> = {}) {
    updates = [];
    const rideRef = { path: `rides/${'r1'}` };
    db = {
        collection: (name: string) => ({
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => ({
                    exists: name === 'rides' ? ride !== null : true,
                    data: () => (name === 'rides' ? ride : users[id] ?? {}),
                }),
                ...(name === 'rides' ? rideRef : {}),
            }),
        }),
        runTransaction: async (fn: any) => fn({
            get: async () => ({ exists: ride !== null, data: () => ride }),
            update: (_ref: any, data: any) => updates.push({ path: 'rides/r1', data }),
        }),
    };
}

const call = (data: any = { rideId: 'r1' }) =>
    (sarthiArrived as any)(data, { auth: { uid: SARTHI } });

const inProgressRide = (over: any = {}) => ({
    driverId: SARTHI,
    status: 'in_progress',
    studentId: 'rider-a',
    students: [{ id: 'rider-a' }, { id: 'rider-b' }, { id: 'rider-c' }],
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    approvedDriver.mockResolvedValue({});
});

describe('sarthiArrived — who is told', () => {
    it('tells only this stop’s rider, not the whole car', async () => {
        // The named regression test. `students` holds the entire carload.
        makeDb(inProgressRide(), {
            'rider-a': { fcmTokens: { 'tok-a': {} } },
            'rider-b': { fcmTokens: { 'tok-b': {} } },
            'rider-c': { fcmTokens: { 'tok-c': {} } },
        });

        await call();

        expect(notifyArrived).toHaveBeenCalledTimes(1);
        expect(notifyArrived.mock.calls[0]![0]).toEqual([{ uid: 'rider-a', token: 'tok-a' }]);
    });
});

describe('sarthiArrived — the state change', () => {
    it('moves in_progress to arriving and stamps the time', async () => {
        makeDb(inProgressRide());
        await call();

        expect(updates).toHaveLength(1);
        expect(updates[0]!.data.status).toBe('arriving');
        expect(updates[0]!.data.arrivedAt).toEqual(expect.any(String));
    });

    it('refuses a ride that has not started', async () => {
        // Placed after in_progress on purpose — see the header.
        makeDb(inProgressRide({ status: 'assigned' }));

        await expect(call()).rejects.toThrow(/cannot be marked as arrived/i);
        expect(updates).toHaveLength(0);
    });

    it('touches only the invoked document, never the rest of the car', async () => {
        makeDb(inProgressRide());
        await call();

        expect(updates.every(u => u.path === 'rides/r1')).toBe(true);
    });
});

describe('sarthiArrived — tapping twice', () => {
    it('does not announce again', async () => {
        makeDb(inProgressRide({ arrivedAt: '2026-08-19T09:00:00.000Z' }));

        const result = await call();

        expect(result).toEqual({ success: true, alreadyArrived: true });
        expect(notifyArrived).not.toHaveBeenCalled();
        expect(updates).toHaveLength(0);
    });

    it('stays quiet even after the ride has been completed', async () => {
        // Guarded on arrivedAt rather than status precisely for this:
        // completeRide moves the document off `arriving`.
        makeDb(inProgressRide({ status: 'completed', arrivedAt: '2026-08-19T09:00:00.000Z' }));

        await expect(call()).resolves.toEqual({ success: true, alreadyArrived: true });
    });
});

describe('sarthiArrived — who may call it', () => {
    it('refuses a Sarthi who is not the one assigned', async () => {
        makeDb(inProgressRide({ driverId: 'someone_else' }));

        await expect(call()).rejects.toThrow(/only the assigned sarthi/i);
        expect(updates).toHaveLength(0);
    });

    it('accepts the nested driver.id shape a manager assignment writes', async () => {
        // completeRide already accepts either; checking only driverId would
        // refuse a legitimately assigned Sarthi.
        makeDb({ ...inProgressRide(), driverId: undefined, driver: { id: SARTHI } });

        await expect(call()).resolves.toEqual({ success: true, alreadyArrived: false });
    });

    it('refuses a revoked Sarthi before touching the ride', async () => {
        approvedDriver.mockRejectedValue(new Error('Only approved drivers can mark arrival.'));
        makeDb(inProgressRide());

        await expect(call()).rejects.toThrow(/approved drivers/i);
        expect(updates).toHaveLength(0);
    });

    it('refuses an unauthenticated caller', async () => {
        makeDb(inProgressRide());
        await expect((sarthiArrived as any)({ rideId: 'r1' }, {})).rejects.toThrow(/authenticated/i);
    });
});

describe('sarthiArrived — a push failure never fails the arrival', () => {
    it('still reports success when the notification throws', async () => {
        // The Sarthi is standing outside a house. The state change is what
        // matters; the push is best-effort.
        makeDb(inProgressRide(), { 'rider-a': { fcmTokens: { 'tok-a': {} } } });
        notifyArrived.mockRejectedValueOnce(new Error('FCM down'));

        await expect(call()).resolves.toEqual({ success: true, alreadyArrived: false });
        expect(updates[0]!.data.status).toBe('arriving');
    });
});
