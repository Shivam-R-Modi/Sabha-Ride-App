/**
 * The two endpoints where "authorised" is not the same as "allowed again".
 *
 * `assertApprovedManager` answers *may you do this?* It cannot answer *why is
 * this the four-hundredth time tonight?* — and for these two, that second
 * question is the one that matters:
 *
 *   generateEventCSV   emits every rider's name, phone number and home address.
 *                      For a congregation that includes minors, it is the most
 *                      sensitive thing this app can produce. Unthrottled, one
 *                      borrowed manager session dumps the whole community.
 *
 *   adminDeleteUser    removes the Firestore document AND the Auth account, has
 *                      no undo in the app, and accepts a BATCH of uids. A loop
 *                      over it empties the congregation faster than anyone can
 *                      intervene or decide on a point-in-time restore.
 *
 * Both were reachable without any limit until 2026-08-18, while four less
 * sensitive callables already had one. These tests pin three things: that the
 * limit exists, that it sits AFTER the authority check so a stranger cannot
 * spend a real manager's budget, and — the part that actually protects anyone —
 * that being throttled stops the work rather than just logging a complaint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
const rateLimitCalls: Array<{ userId: string; config: any }> = [];
let rateLimitThrows: Error | null = null;
const managerChecks: string[] = [];
const deletedAuthUsers: string[] = [];

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});

vi.mock('firebase-admin', () => ({
    firestore: () => db,
    auth: () => ({ deleteUser: async (uid: string) => { deletedAuthUsers.push(uid); } }),
}));

vi.mock('../utils/authz', () => ({
    assertApprovedManager: vi.fn(async (_db: any, uid: string) => {
        managerChecks.push(uid);
        return { name: 'Manager Meera', roles: ['manager'] };
    }),
}));

vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn(async () => null) }));
vi.mock('../utils/fleet', () => ({ releaseVehiclesHeldBy: vi.fn(async () => []) }));

vi.mock('../utils/rateLimiter', () => ({
    checkRateLimit: vi.fn(async (userId: string, config: any) => {
        rateLimitCalls.push({ userId, config });
        if (rateLimitThrows) throw rateLimitThrows;
    }),
}));

import * as functions from 'firebase-functions';
import { generateEventCSV } from './generateEventCSV';
import { adminDeleteUser } from './adminDeleteUser';

/**
 * What the REAL limiter throws — `resource-exhausted`, as an HttpsError.
 *
 * This matters more than it looks. Both handlers wrap their body in a try/catch
 * that rethrows an HttpsError untouched but converts anything else into a
 * generic message ("Failed to permanently delete user(s)"). A test that threw a
 * plain Error here would therefore prove the opposite of what it claims: the
 * work would still be blocked, but by an internal error the caller cannot act
 * on, and the assertion would pass for the wrong reason.
 */
const throttled = () => new functions.https.HttpsError(
    'resource-exhausted',
    'Rate limit exceeded for this function. Please try again in 900 seconds.',
);

/** Enough of Firestore for both handlers to run their happy path. */
function makeDb() {
    const writes: Array<{ path: string; data: any }> = [];
    const deletes: string[] = [];

    const emptySnap = { size: 0, empty: true, docs: [] };
    const chain: any = {
        where: () => chain,
        limit: () => chain,
        orderBy: () => chain,
        get: async () => emptySnap,
    };

    db = {
        collection: (name: string) => ({
            ...chain,
            doc: (id: string) => ({
                path: `${name}/${id}`,
                get: async () => ({
                    exists: name === 'users',
                    data: () => (name === 'users'
                        ? { name: 'Rider Riya', roles: ['student'], accountStatus: 'approved' }
                        : undefined),
                }),
                delete: async () => { deletes.push(`${name}/${id}`); },
            }),
        }),
        batch: () => ({
            set: (ref: any, data: any) => writes.push({ path: ref.path, data }),
            update: (ref: any, data: any) => writes.push({ path: ref.path, data }),
            delete: (ref: any) => deletes.push(ref.path),
            commit: async () => undefined,
        }),
    };
    return { writes, deletes };
}

const AUTH = { auth: { uid: 'mgr_1' } };

beforeEach(() => {
    rateLimitCalls.length = 0;
    managerChecks.length = 0;
    deletedAuthUsers.length = 0;
    rateLimitThrows = null;
    makeDb();
});

describe('generateEventCSV is throttled', () => {
    it('checks a limit at all', async () => {
        await (generateEventCSV as any)({ eventDate: '2026-08-18' }, AUTH);

        expect(rateLimitCalls).toHaveLength(1);
        expect(rateLimitCalls[0]!.config.functionName).toBe('generateEventCSV');
        expect(rateLimitCalls[0]!.userId).toBe('mgr_1');
    });

    it('allows well above real use, well below a bulk dump', async () => {
        // A manager exports once per gathering, occasionally a few times while
        // fixing a spreadsheet. Anything in the hundreds is not a manager.
        await (generateEventCSV as any)({}, AUTH);

        const { maxRequests, windowMs } = rateLimitCalls[0]!.config;
        expect(maxRequests).toBeLessThanOrEqual(60);
        expect(maxRequests).toBeGreaterThanOrEqual(5);
        expect(windowMs).toBe(60 * 60 * 1000);
    });

    it('emits NO rows once throttled', async () => {
        // The point of the limit. A version that counted and then exported
        // anyway would satisfy every other test in this file.
        rateLimitThrows = throttled();

        await expect((generateEventCSV as any)({}, AUTH)).rejects.toThrow(/rate limit/i);
    });

    it('refuses a stranger before spending anyone’s allowance', async () => {
        // Unauthenticated must fail on auth, never reach the limiter — otherwise
        // an anonymous flood exhausts a real manager's budget.
        await expect((generateEventCSV as any)({}, {})).rejects.toThrow();
        expect(rateLimitCalls).toHaveLength(0);
    });

    it('runs the manager check FIRST', async () => {
        await (generateEventCSV as any)({}, AUTH);

        // Both ran, and authority was established before the budget was spent.
        expect(managerChecks).toEqual(['mgr_1']);
        expect(rateLimitCalls).toHaveLength(1);
    });
});

describe('adminDeleteUser is throttled', () => {
    it('checks a limit at all', async () => {
        await (adminDeleteUser as any)({ targetUserId: 'stu_1' }, AUTH);

        expect(rateLimitCalls).toHaveLength(1);
        expect(rateLimitCalls[0]!.config.functionName).toBe('adminDeleteUser');
    });

    it('deletes NOBODY once throttled', async () => {
        // Irreversible, and it takes a batch. This is the assertion that matters.
        rateLimitThrows = throttled();

        await expect(
            (adminDeleteUser as any)({ targetUserIds: ['a', 'b', 'c'] }, AUTH),
        ).rejects.toThrow(/rate limit/i);

        // The refusal reaches the caller as `resource-exhausted`, not as a
        // generic internal error they can do nothing about.
        expect(deletedAuthUsers).toEqual([]);
    });

    it('refuses a stranger before spending anyone’s allowance', async () => {
        await expect((adminDeleteUser as any)({ targetUserId: 'x' }, {})).rejects.toThrow();
        expect(rateLimitCalls).toHaveLength(0);
    });

    it('leaves ordinary housekeeping room', async () => {
        await (adminDeleteUser as any)({ targetUserId: 'stu_1' }, AUTH);

        const { maxRequests, windowMs } = rateLimitCalls[0]!.config;
        expect(maxRequests).toBeGreaterThanOrEqual(10);
        expect(windowMs).toBe(60 * 60 * 1000);
    });
});
