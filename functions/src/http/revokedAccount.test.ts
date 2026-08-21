/**
 * ONE POLICY, FIVE CALLABLES: ownership is not authorisation.
 *
 * Five endpoints checked only that the caller was the person named on the document
 * and nothing else — no role, no account status. So a REVOKED or rejected account
 * kept working for as long as its name sat on a ride:
 *
 *   startRide          flipped a whole car to in_progress and every passenger to in_ride
 *   completeRide       wrote statistics, released the vehicle, moved driver counters
 *   releaseAssignment  put riders back in the pool
 *   driverDoneForToday ended a shift and released a car
 *   studentReadyToLeave filed a drop-off request, entering the dispatch pool
 *
 * `sarthiArrived` already named the gap in a comment — "Stricter than
 * startRide/completeRide, which check ownership only" — so it was known and
 * unfixed. `authz.ts` documents the same shape being found once before: Reject in
 * the manager console writes `accountStatus` alone, leaving `role: 'manager'` in
 * place, so revocation never reached the functions that mattered.
 *
 * Tested in ONE file because it is ONE rule. Five near-identical files would let the
 * rule drift five ways.
 *
 * The guard sits before any document read in every case, so the fake db only has to
 * answer for `users/{uid}` — which is also the point: nothing is fetched on behalf of
 * a caller who has no business here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let userDoc: Record<string, unknown> | null = null;

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    }
    return {
        https: { onCall: (handler: any) => handler, HttpsError: FakeHttpsError },
        pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (h: any) => h }) }) },
    };
});

/**
 * Tagged by collection. `users` answers with the fixture; everything else is empty,
 * so an APPROVED caller falls through to 'not-found' rather than tripping over a
 * ride document that happens to be the user document wearing a hat.
 */
const db: any = {
    collection: (name: string) => ({
        doc: () => ({
            path: `${name}/x`,
            get: async () => (name === 'users'
                ? { exists: userDoc !== null, data: () => userDoc ?? undefined }
                : { exists: false, data: () => undefined }),
        }),
        where: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }),
    }),
    batch: () => ({ set: () => undefined, update: () => undefined, delete: () => undefined, commit: async () => undefined }),
};

vi.mock('firebase-admin', () => ({ firestore: () => db }));

vi.mock('../utils/notifications', () => ({
    notifyStudentRideStarting: vi.fn(async () => undefined),
    notifyStudentRideCompleted: vi.fn(async () => undefined),
    notifyDriverStudentsAssigned: vi.fn(async () => undefined),
    notifyStudentDriverAssigned: vi.fn(async () => undefined),
    tokensOf: () => [],
}));

vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: vi.fn(async () => undefined) }));

import { startRide } from './startRide';
import { completeRide } from './completeRide';
import { releaseAssignment } from './releaseAssignment';
import { driverDoneForToday } from './driverDoneForToday';
import { studentReadyToLeave } from './studentReadyToLeave';
import { nudgeRider } from './nudgeRider';

const UID = 'dave';
const ctx = { auth: { uid: UID } };

/** Every callable, with a payload naming the caller as the person acting. */
const CALLS: Array<[string, () => Promise<unknown>]> = [
    ['startRide', () => (startRide as any)({ rideId: 'r1' }, ctx)],
    ['completeRide', () => (completeRide as any)({ rideId: 'r1' }, ctx)],
    ['releaseAssignment', () => (releaseAssignment as any)({ rideId: 'r1' }, ctx)],
    ['driverDoneForToday', () => (driverDoneForToday as any)({ driverId: UID }, ctx)],
    ['studentReadyToLeave', () => (studentReadyToLeave as any)({ studentId: UID }, ctx)],
    // The newest one, and the only path that pushes a message from a driver to a
    // child's phone. It joins the list rather than growing a file of its own,
    // because it is the same rule.
    ['nudgeRider', () => (nudgeRider as any)({ rideId: 'r1', studentId: 'stu_1' }, ctx)],
];

beforeEach(() => { vi.clearAllMocks(); });

describe('a revoked account cannot act, however its name sits on a document', () => {
    it.each(CALLS)('%s refuses a rejected account', async (_name, call) => {
        userDoc = { name: 'Dave', accountStatus: 'rejected', roles: ['driver', 'student'] };
        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it.each(CALLS)('%s refuses an account still pending approval', async (_name, call) => {
        userDoc = { name: 'Dave', accountStatus: 'pending', roles: ['driver', 'student'] };
        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it.each(CALLS)('%s refuses an account with no role recorded at all', async (_name, call) => {
        // Approved, but not as anything. The `accountStatus` check alone would pass.
        userDoc = { name: 'Dave', accountStatus: 'approved' };
        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it.each(CALLS)('%s refuses a caller with no user document', async (_name, call) => {
        userDoc = null;
        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    });
});

describe('the guard runs before anything is read or written', () => {
    it('does not fetch the ride for a revoked caller', async () => {
        // Not merely tidiness: fetching first is how driverDoneForToday and
        // studentReadyToLeave became existence oracles, answering 'not found' versus
        // 'permission-denied' for an arbitrary uid.
        userDoc = { accountStatus: 'rejected', roles: ['driver'] };
        const seen: string[] = [];
        const spyDb: any = {
            collection: (name: string) => {
                seen.push(name);
                return {
                    doc: () => ({
                        path: `${name}/x`,
                        get: async () => ({ exists: userDoc !== null, data: () => userDoc ?? undefined }),
                    }),
                    where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
                };
            },
            batch: () => ({ set: () => undefined, update: () => undefined, commit: async () => undefined }),
        };
        const admin = await import('firebase-admin');
        (admin as any).firestore = () => spyDb;

        await expect((startRide as any)({ rideId: 'r1' }, ctx))
            .rejects.toMatchObject({ code: 'permission-denied' });

        expect(seen).not.toContain('rides');
        (admin as any).firestore = () => db;
    });
});

describe('an approved account still gets through the guard', () => {
    it('does not refuse a genuine Sarthi at the authorisation step', async () => {
        // Guards against over-tightening: it must fail LATER (no such ride), not at
        // the role check. A guard that refuses everybody is not a fix.
        userDoc = { name: 'Dave', accountStatus: 'approved', roles: ['driver'] };
        await expect((startRide as any)({ rideId: 'r1' }, ctx))
            .rejects.toMatchObject({ code: 'not-found' });
    });

    it('lets a manager act as a Sarthi, which the hierarchy grants', async () => {
        // A manager is recorded only as a manager and still drives in this
        // congregation — assertApprovedDriver reads the GRANTED set for that reason.
        userDoc = { name: 'Mira', accountStatus: 'approved', role: 'manager' };
        await expect((startRide as any)({ rideId: 'r1' }, ctx))
            .rejects.toMatchObject({ code: 'not-found' });
    });
});
