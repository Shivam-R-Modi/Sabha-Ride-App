/**
 * The second nudge — a new message path from a Sarthi to a child's phone.
 *
 * `sarthiArrived` already fires once, automatically. This is the button for
 * afterwards: the Sarthi is outside, nobody has come out, and the policy the
 * owner chose is **wait and nudge** — the roster never changes mid-run, so no
 * seat is handed to anybody else while a car is parked outside a house.
 *
 * WHAT THIS FILE IS GUARDING
 * -------------------------
 * A driver-to-child push on an app holding minors' details. So:
 *
 *   - The text is FIXED. `managerBroadcast` already set that precedent for the
 *     title, "because a free-text title could impersonate a system push". Here
 *     the whole message is fixed, and a caller who sends a body is ignored.
 *   - Only the rider whose stop it is. `globalAssignDriver` copies the WHOLE
 *     car's roster onto every ride document, so a careless implementation buzzes
 *     four children to tell one of them to come outside. `sarthiArrived` has a
 *     test named for exactly this mistake.
 *   - A cooldown PER RIDER, not per Sarthi. A shared allowance would mean four
 *     late riders exhaust each other's, and the thing worth preventing is twenty
 *     buzzes on one child's phone.
 *   - `delivered` comes back, because a bell that silently reaches nobody is the
 *     failure mode this repo keeps finding. The Sarthi is told to phone instead.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let rideDoc: Record<string, any> | null;
let riderDoc: Record<string, any> | undefined;
let driverDoc: Record<string, any> | null;

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

/**
 * `notifyStudentSarthiWaiting` is the seam the callable actually uses, and it is
 * where the fixed wording lives — notifications.test.ts owns that text. What
 * matters here is WHO it is handed and that nothing else is.
 */
const notifyStudentSarthiWaiting = vi.fn(
    async (_recipients: Array<{ uid: string; token: string }>) => ({ delivered: 1, failed: 0, pruned: 0 }));
vi.mock('../utils/notifications', async (importOriginal) => {
    const real = await importOriginal<typeof import('../utils/notifications')>();
    return {
        ...real,
        notifyStudentSarthiWaiting: (...a: unknown[]) => notifyStudentSarthiWaiting(...(a as [Array<{ uid: string; token: string }>])),
    };
});

const checkRateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({
    checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])),
}));

import { nudgeRider, NUDGE_COOLDOWN_MS } from './nudgeRider';

const DRIVER = 'driver_dave';
const RIDER = 'stu_b';

/** Writes the transaction made, so a test can read what was recorded. */
let updates: Array<{ path: string; data: any }>;

function makeDb() {
    updates = [];
    const snap = (exists: boolean, data?: any) => ({ exists, data: () => data });
    db = {
        collection: (name: string) => ({
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => (name === 'users'
                    ? snap(true, id === DRIVER ? (driverDoc ?? undefined) : riderDoc)
                    : snap(rideDoc !== null, rideDoc ?? undefined)),
            }),
        }),
        runTransaction: async (fn: any) => fn({
            get: async (ref: any) => {
                if (ref.path.startsWith('rides/')) return snap(rideDoc !== null, rideDoc ?? undefined);
                return snap(true, ref.path === `users/${DRIVER}` ? (driverDoc ?? undefined) : riderDoc);
            },
            update: (ref: any, data: any) => updates.push({ path: ref.path, data }),
        }),
    };
}

const call = (payload: Record<string, unknown> = {}, uid = DRIVER) =>
    (nudgeRider as any)(
        { rideId: 'ride_1', studentId: RIDER, ...payload },
        { auth: { uid } },
    );

beforeEach(() => {
    vi.clearAllMocks();
    driverDoc = { name: 'Dave', accountStatus: 'approved', roles: ['driver'] };
    riderDoc = { name: 'Bhulku B', fcmTokens: { tok_1: {} } };
    rideDoc = {
        driverId: DRIVER,
        status: 'arriving',
        studentId: 'stu_a',
        students: [{ id: 'stu_a', name: 'Bhulku A' }, { id: RIDER, name: 'Bhulku B' }],
    };
    makeDb();
});

describe('who may nudge', () => {
    it('refuses an unauthenticated caller', async () => {
        await expect((nudgeRider as any)({ rideId: 'ride_1', studentId: RIDER }, {}))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('refuses a Sarthi who is not driving this run', async () => {
        await expect(call({}, 'driver_dina')).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('refuses a revoked account whose name is still on the ride', async () => {
        driverDoc = { name: 'Dave', accountStatus: 'rejected', roles: ['driver'] };
        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('accepts the driver recorded under `driver.id` too', async () => {
        // The manager console writes `driver.id`; the dispatcher writes `driverId`.
        rideDoc = { ...rideDoc, driverId: undefined, driver: { id: DRIVER } };
        await expect(call()).resolves.toMatchObject({ success: true });
    });
});

describe('who may be nudged', () => {
    it('refuses a rider who is not on this run', async () => {
        await expect(call({ studentId: 'someone_elses_child' }))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('nudges ONLY that rider, not the whole car', async () => {
        // The roster on this document names two children. One of them is late.
        await call();

        expect(notifyStudentSarthiWaiting).toHaveBeenCalledTimes(1);
        expect(notifyStudentSarthiWaiting.mock.calls[0][0].map(r => r.uid)).toEqual([RIDER]);
    });

    it('allows the rider whose own document this is', async () => {
        await expect(call({ studentId: 'stu_a' })).resolves.toMatchObject({ success: true });
    });

    it('refuses an id that could not be a rider at all', async () => {
        // The cooldown is recorded at `nudges.<id>`, so a dotted id would write
        // somewhere else entirely.
        await expect(call({ studentId: 'a.b' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ studentId: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});

describe('when a nudge makes sense', () => {
    it('works while the Sarthi is outside', async () => {
        rideDoc = { ...rideDoc, status: 'arriving' };
        await expect(call()).resolves.toMatchObject({ success: true });
    });

    it('works while the run is under way', async () => {
        rideDoc = { ...rideDoc, status: 'in_progress' };
        await expect(call()).resolves.toMatchObject({ success: true });
    });

    it('refuses once the run is over', async () => {
        rideDoc = { ...rideDoc, status: 'completed' };
        await expect(call()).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('refuses a ride that does not exist', async () => {
        rideDoc = null;
        await expect(call()).rejects.toMatchObject({ code: 'not-found' });
    });
});

describe('the message is fixed', () => {
    it('passes nothing but the recipients, so nothing a caller sends reaches a phone', async () => {
        await call({
            body: 'Get out here NOW',
            title: 'Bhulka Gaadi security alert',
            message: 'anything',
        });

        // One argument, and it is the audience. The title and body are chosen in
        // notifications.ts and cannot be reached from here at all.
        expect(notifyStudentSarthiWaiting.mock.calls[0]).toHaveLength(1);
        expect(notifyStudentSarthiWaiting.mock.calls[0][0].map(r => r.uid)).toEqual([RIDER]);
    });
});

describe('one tap is not twenty buzzes', () => {
    it('records the nudge against that rider', async () => {
        await call();

        const write = updates.find(u => u.path === 'rides/ride_1')!;
        expect(Object.keys(write.data)).toEqual([`nudges.${RIDER}`]);
    });

    it('refuses a second nudge inside the cooldown', async () => {
        rideDoc = { ...rideDoc, nudges: { [RIDER]: new Date().toISOString() } };

        await expect(call()).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(notifyStudentSarthiWaiting).not.toHaveBeenCalled();
    });

    it('says how long is left', async () => {
        rideDoc = { ...rideDoc, nudges: { [RIDER]: new Date().toISOString() } };

        await expect(call()).rejects.toThrow(/second/i);
    });

    it('allows it again once the cooldown has passed', async () => {
        rideDoc = {
            ...rideDoc,
            nudges: { [RIDER]: new Date(Date.now() - NUDGE_COOLDOWN_MS - 1000).toISOString() },
        };

        await expect(call()).resolves.toMatchObject({ success: true });
    });

    it('holds a cooldown per rider, not per Sarthi', async () => {
        // Two children late in the same minute is an ordinary evening. One
        // allowance shared between them would silence the second.
        rideDoc = { ...rideDoc, nudges: { [RIDER]: new Date().toISOString() } };

        await expect(call({ studentId: 'stu_a' })).resolves.toMatchObject({ success: true });
    });

    it('still asks the shared rate limiter', async () => {
        await call();

        expect(checkRateLimit).toHaveBeenCalledWith(DRIVER, expect.objectContaining({
            functionName: 'nudgeRider',
        }));
    });
});

describe('a bell that reaches nobody says so', () => {
    it('reports how many devices were reached', async () => {
        const result = await call();

        expect(result).toMatchObject({ delivered: 1 });
    });

    it('reports zero for a rider with no phone registered', async () => {
        // The Sarthi needs to know to use the phone button instead. Reporting
        // success here is the silent-nothing failure this repo keeps removing.
        riderDoc = { name: 'Bhulku B' };

        const result = await call();

        expect(result.delivered).toBe(0);
        expect(notifyStudentSarthiWaiting).not.toHaveBeenCalled();
    });

    it('does not burn the cooldown when there was nobody to tell', async () => {
        riderDoc = { name: 'Bhulku B' };

        await call();

        expect(updates).toEqual([]);
    });
});
