/**
 * Deleting a gathering is not a one-document delete, and these tests assert on the
 * BATCH PAYLOAD for the same reason globalAssignDriver's do: what was wrong was
 * never the return value.
 *
 * What must happen together: the event goes, outstanding ride requests become
 * `cancelled` (not deleted — the rider keeps an explanation, and `requested` is
 * what globalAssignDriver picks up), the attendance cascade is parked so a crash
 * cannot lose it, and rideContext is rewritten if this was the current gathering.
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
        https: { onCall: (h: any) => h, HttpsError: FakeHttpsError },
    };
});

vi.mock('firebase-admin', () => ({
    firestore: Object.assign(() => db, {
        FieldValue: {
            arrayUnion: (...v: string[]) => ({ __arrayUnion: v }),
            arrayRemove: (...v: string[]) => ({ __arrayRemove: v }),
        },
        FieldPath: { documentId: () => '__name__' },
    }),
}));

vi.mock('../utils/rateLimiter', () => ({
    checkRateLimit: vi.fn(async () => undefined),
}));

const sendMulticast = vi.fn(async () => undefined);
vi.mock('../utils/notifications', () => ({
    sendMulticastNotification: (...args: any[]) => sendMulticast(...(args as [])),
}));

import { deleteSabhaEvent } from './deleteSabhaEvent';

// ── fixtures ───────────────────────────────────────────────────────────
const ZONE = 'America/New_York';
const MANAGER = { role: 'manager', accountStatus: 'approved', name: 'Mira' };
/** "now" is Fri 7 Aug 2026, 10:00 Boston, so 08-14 is comfortably in the future. */
const NOW = new Date('2026-08-07T14:00:00Z');

interface Fixture {
    caller?: Record<string, unknown>;
    events?: Record<string, any>;
    rides?: Array<{ id: string; data: Record<string, unknown> }>;
    responses?: string[];
    contextEventId?: string | null;
    users?: Record<string, any>;
}

interface Recorder {
    deletes: string[];
    updates: Array<{ path: string; data: any }>;
    sets: Array<{ path: string; data: any }>;
    committed: boolean;
    recursiveDeletes: string[];
}

function makeDb(f: Fixture) {
    const rec: Recorder = {
        deletes: [], updates: [], sets: [], committed: false, recursiveDeletes: [],
    };
    const events = f.events ?? { '2026-08-14': { date: '2026-08-14', status: 'scheduled', startTime: '19:00', endTime: '22:00' } };
    const rides = f.rides ?? [];
    const users: Record<string, any> = { caller: f.caller ?? MANAGER, ...(f.users ?? {}) };

    const snap = (exists: boolean, data?: any) => ({ exists, data: () => data });

    const ref = (path: string) => ({ path });

    const collection = (name: string): any => ({
        doc: (id: string) => ({
            path: `${name}/${id}`,
            get: async () => {
                if (name === 'events') return snap(id in events, events[id]);
                if (name === 'settings') return snap(true, { timeZone: ZONE });
                if (name === 'users') return snap(true, users[id] ?? users.caller);
                if (name === 'weeklyAttendance') return snap(true, {});
                return snap(false);
            },
            set: async (data: any) => { rec.sets.push({ path: `${name}/${id}`, data }); },
            // weeklyAttendance/{id}/responses
            collection: (sub: string) => ({
                get: async () => ({
                    size: (f.responses ?? []).length,
                    docs: (f.responses ?? []).map(uid => ({ id: uid, ref: ref(`${name}/${id}/${sub}/${uid}`) })),
                }),
            }),
        }),
        where: () => ({
            get: async () => ({
                docs: rides.map(r => ({
                    id: r.id,
                    ref: ref(`rides/${r.id}`),
                    data: () => r.data,
                })),
            }),
            where: () => ({ get: async () => ({ docs: [] }) }),
            orderBy: () => ({ get: async () => ({ docs: [] }) }),
        }),
    });

    db = {
        collection,
        doc: (path: string) => ({
            path,
            get: async () => {
                if (path === 'system/rideContext') {
                    return snap(true, { eventId: f.contextEventId ?? null });
                }
                return snap(false, {});
            },
            set: async (data: any) => { rec.sets.push({ path, data }); },
        }),
        batch: () => ({
            delete: (r: any) => rec.deletes.push(r.path),
            update: (r: any, data: any) => rec.updates.push({ path: r.path, data }),
            set: (r: any, data: any) => rec.sets.push({ path: r.path, data }),
            commit: async () => { rec.committed = true; },
        }),
        recursiveDelete: async (r: any) => { rec.recursiveDeletes.push(r.path); },
    };

    return rec;
}

const call = (data: any, uid = 'mgr-1') =>
    (deleteSabhaEvent as any)(data, { auth: { uid } });

beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
});

// ── refusals ───────────────────────────────────────────────────────────

describe('deleteSabhaEvent — refusals', () => {
    it('refuses an unauthenticated caller', async () => {
        makeDb({});
        await expect((deleteSabhaEvent as any)({ date: '2026-08-14' }, {}))
            .rejects.toThrow(/authenticated/i);
    });

    // The check itself now lives in utils/authz.ts, shared with the four other
    // callables that each had their own divergent copy. Its truth table is
    // covered cell by cell in authz.test.ts; these two keep the guard wired in.
    it('refuses a non-manager', async () => {
        makeDb({ caller: { role: 'student', accountStatus: 'approved' } });
        await expect(call({ date: '2026-08-14' })).rejects.toThrow(/Only approved managers/i);
    });

    it('refuses an unapproved manager', async () => {
        makeDb({ caller: { role: 'manager', accountStatus: 'pending' } });
        await expect(call({ date: '2026-08-14' })).rejects.toThrow(/Only approved managers/i);
    });

    it('refuses a malformed date', async () => {
        makeDb({});
        await expect(call({ date: 'next friday' })).rejects.toThrow(/date is required/i);
        await expect(call({})).rejects.toThrow(/date is required/i);
    });

    it('refuses a date that is not on the calendar', async () => {
        makeDb({ events: {} });
        await expect(call({ date: '2026-08-14' })).rejects.toThrow(/no longer on the calendar/i);
    });

    it('refuses today, pointing at the alternative', async () => {
        // Completed rides and attendance reference it, and today is also a weekly
        // slot date — deleting it invites the seeder to argue with the manager.
        makeDb({ events: { '2026-08-07': { date: '2026-08-07', status: 'scheduled' } } });
        await expect(call({ date: '2026-08-07' })).rejects.toThrow(/Today's sabha cannot be deleted/i);
    });

    it('refuses a past sabha', async () => {
        makeDb({ events: { '2026-07-31': { date: '2026-07-31', status: 'scheduled' } } });
        await expect(call({ date: '2026-07-31' })).rejects.toThrow(/already happened/i);
    });

    it('refuses when a driver is already on the road', async () => {
        makeDb({
            rides: [{ id: 'r1', data: { status: 'in_progress', eventDate: '2026-08-14' } }],
        });
        await expect(call({ date: '2026-08-14' })).rejects.toThrow(/Release them first/i);
    });

    it('refuses without acknowledgement when people are affected', async () => {
        // Enforced on the SERVER. A client-side-only guard is how the cancel
        // button died: suppressed confirm() returned false and the handler bailed.
        makeDb({
            responses: ['stu-a', 'stu-b'],
            rides: [{ id: 'r1', data: { status: 'requested', studentId: 'stu-a', eventDate: '2026-08-14' } }],
        });
        await expect(call({ date: '2026-08-14' })).rejects.toThrow(/Confirm the deletion/i);
    });

    it('allows deletion without acknowledgement when nobody is affected', async () => {
        // The common case: an auto-created sabha nobody has touched.
        const rec = makeDb({});
        const result: any = await call({ date: '2026-08-14' });

        expect(result.deleted).toBe(true);
        // Cancelled rather than removed — see the note on the commit test below.
        expect(rec.sets.find(s => s.path === 'events/2026-08-14')!.data.status)
            .toBe('cancelled');
    });
});

// ── preview ────────────────────────────────────────────────────────────

describe('deleteSabhaEvent — preview', () => {
    it('reports the counts without changing anything', async () => {
        const rec = makeDb({
            responses: ['stu-a', 'stu-b', 'stu-c'],
            rides: [
                { id: 'r1', data: { status: 'requested', studentId: 'stu-a', eventDate: '2026-08-14' } },
                { id: 'r2', data: { status: 'requested', studentId: 'stu-b', eventDate: '2026-08-14' } },
            ],
            contextEventId: '2026-08-14',
        });

        const preview: any = await call({ date: '2026-08-14', dryRun: true });

        expect(preview).toMatchObject({
            date: '2026-08-14',
            responseCount: 3,
            requestedRideCount: 2,
            isCurrentEvent: true,
        });
        expect(rec.committed).toBe(false);
        expect(rec.deletes).toEqual([]);
        expect(rec.recursiveDeletes).toEqual([]);
    });
});

// ── the happy path, asserted on the batch ──────────────────────────────

describe('deleteSabhaEvent — what actually gets written', () => {
    it('CANCELS the event, cancels requests, parks the cascade — in one commit', async () => {
        const rec = makeDb({
            responses: ['stu-a'],
            rides: [
                { id: 'r1', data: { status: 'requested', studentId: 'stu-a', eventDate: '2026-08-14' } },
                { id: 'r2', data: { status: 'completed', studentId: 'stu-b', eventDate: '2026-08-14' } },
            ],
        });

        await call({ date: '2026-08-14', acknowledge: true });

        expect(rec.committed).toBe(true);

        // A cancellation EXCEPTION, not a delete. Under the rule model the
        // schedule lives in settings/sabhaRecurrence, so removing this document
        // would let the rule place the gathering again and the manager's
        // cancellation would evaporate on the next tick.
        expect(rec.deletes).toEqual([]);
        const eventWrite = rec.sets.find(s => s.path === 'events/2026-08-14')!;
        expect(eventWrite.data.status).toBe('cancelled');
        expect(eventWrite.data.kind).toBe('override');

        // Requested rides cancelled — NOT deleted, so the rider keeps a record,
        // and 'cancelled' is what takes them out of the assignment pool.
        const rideUpdate = rec.updates.find(u => u.path === 'rides/r1')!;
        expect(rideUpdate.data.status).toBe('cancelled');
        expect(rideUpdate.data.cancelledReason).toBe('sabha-deleted');

        // The completed ride is left alone.
        expect(rec.updates.find(u => u.path === 'rides/r2')).toBeUndefined();

        // The cascade is parked in the same commit, so a crash cannot lose it.
        const parked = rec.sets.find(s => s.path === 'system/eventGenerator')!;
        expect(parked.data.pendingAttendanceDeletes).toEqual({ __arrayUnion: ['2026-08-14'] });
    });

    it('recursively deletes the attendance record and its responses', async () => {
        // The whole point: Firestore leaves responses/* behind when the parent goes.
        const rec = makeDb({ responses: ['stu-a', 'stu-b'] });

        await call({ date: '2026-08-14', acknowledge: true });

        expect(rec.recursiveDeletes).toEqual(['weeklyAttendance/2026-08-14']);
    });

    it('clears the parked date once the cascade has run', async () => {
        const rec = makeDb({ responses: ['stu-a'] });

        await call({ date: '2026-08-14', acknowledge: true });

        const cleared = rec.sets.filter(s =>
            s.path === 'system/eventGenerator' && s.data.pendingAttendanceDeletes?.__arrayRemove);
        expect(cleared).toHaveLength(1);
        expect(cleared[0].data.pendingAttendanceDeletes).toEqual({ __arrayRemove: ['2026-08-14'] });
    });

    it('rewrites rideContext immediately when the current gathering is deleted', async () => {
        // rideContext is only recomputed once a minute. Left stale it would name a
        // deleted document, and a student could re-create the attendance response
        // this function just deleted.
        const rec = makeDb({ contextEventId: '2026-08-14' });

        await call({ date: '2026-08-14', acknowledge: true });

        const ctx = rec.sets.find(s => s.path === 'system/rideContext')!;
        expect(ctx).toBeDefined();
        expect(ctx.data.eventId).not.toBe('2026-08-14');
    });

    it('leaves rideContext alone when a later gathering is deleted', async () => {
        const rec = makeDb({ contextEventId: '2026-08-07' });

        await call({ date: '2026-08-14', acknowledge: true });

        expect(rec.sets.find(s => s.path === 'system/rideContext')).toBeUndefined();
    });

    it('notifies the people who said yes or asked for a ride', async () => {
        makeDb({
            responses: ['stu-a'],
            rides: [{ id: 'r1', data: { status: 'requested', studentId: 'stu-b', eventDate: '2026-08-14' } }],
            users: {
                'stu-a': { fcmToken: 'token-a' },
                'stu-b': { fcmToken: 'token-b' },
            },
        });

        await call({ date: '2026-08-14', acknowledge: true });

        expect(sendMulticast).toHaveBeenCalledTimes(1);
        const [tokens, title] = sendMulticast.mock.calls[0] as any[];
        expect(tokens.sort()).toEqual(['token-a', 'token-b']);
        expect(title).toMatch(/cancelled/i);
    });

    it('does not notify when nobody was affected', async () => {
        makeDb({});
        await call({ date: '2026-08-14', acknowledge: true });
        expect(sendMulticast).not.toHaveBeenCalled();
    });

    it('writes an audit row before and after', async () => {
        const rec = makeDb({ responses: ['stu-a'] });

        await call({ date: '2026-08-14', acknowledge: true });

        const auditWrites = rec.sets.filter(s => s.path.startsWith('auditLogs/'));
        expect(auditWrites.length).toBeGreaterThanOrEqual(2);
        // Was `state: 'pending'` / `'done'`, in a schema unique to this function.
        expect(auditWrites[0].data.outcome).toBe('pending');
        expect(auditWrites[auditWrites.length - 1].data.outcome).toBe('ok');
    });

    it('writes `timestamp`, so the row is visible to the console query', async () => {
        // The regression that made this whole change necessary. This function wrote
        // `performedAt`, and useAdminDatabase orders by `timestamp` — Firestore
        // excludes documents missing the orderBy field, so all five sabha deletions
        // in production were absent from the Audit Logs tab. Logged, and unreadable.
        const rec = makeDb({ responses: ['stu-a'] });

        await call({ date: '2026-08-14', acknowledge: true });

        const first = rec.sets.filter(s => s.path.startsWith('auditLogs/'))[0];
        expect(typeof first.data.timestamp).toBe('string');
        expect(first.data.action).toBe('event.delete');
        expect(first.data.summary).toMatch(/Deleted the sabha on 2026-08-14/);
    });
});
