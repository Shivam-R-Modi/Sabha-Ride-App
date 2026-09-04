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
    sendNotification: (...args: any[]) => sendMulticast(...(args as [])),
    // The real one reads both the fcmTokens map and the legacy single field.
    // Kept faithful here so the test still exercises which PEOPLE are reached.
    tokensOf: (uid: string, data: any) => {
        const out: { uid: string; token: string }[] = [];
        for (const token of Object.keys(data?.fcmTokens ?? {})) out.push({ uid, token });
        if (typeof data?.fcmToken === 'string' && data.fcmToken) out.push({ uid, token: data.fcmToken });
        return out;
    },
}));

import { deleteSabhaEvent } from './deleteSabhaEvent';

// ── fixtures ───────────────────────────────────────────────────────────
const ZONE = 'America/New_York';
const MANAGER = { role: 'manager', accountStatus: 'approved', name: 'Mira' };
/** "now" is Fri 7 Aug 2026, 10:00 Boston, so 08-14 is comfortably in the future. */
const NOW = new Date('2026-08-07T14:00:00Z');

interface Fixture {
    caller?: Record<string, unknown>;
    /** The weekly rule. `null` means no schedule is set at all. */
    rule?: Record<string, unknown> | null;
    events?: Record<string, any>;
    rides?: Array<{ id: string; data: Record<string, unknown> }>;
    responses?: string[];
    contextEventId?: string | null;
    /** Per-hall slices of system/rideContext. Absent means only the aggregate exists. */
    contextByLocation?: Record<string, { eventId?: string | null }>;
    users?: Record<string, any>;
    /**
     * The `locations` collection.
     *
     * Defaults to the founding hall alone, which is production today. Before this
     * existed the fake had no `collection('locations').get()` at all, so
     * `getActiveLocations` threw, was caught, returned [] and fell through to
     * `locationsOrFoundingFallback` — every test in this file passed through an error
     * path, and none of them could have noticed a hall being read wrongly.
     */
    locations?: Record<string, any>;
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
    const locations = f.locations ?? {
        'boston-huntington': {
            name: 'Huntington Ave',
            venue: { lat: 42.339925, lng: -71.088182, address: '360 Huntington Ave' },
            active: true, order: 0,
        },
    };

    const snap = (exists: boolean, data?: any) => ({ exists, data: () => data });

    const ref = (path: string) => ({ path });

    const collection = (name: string): any => ({
        // A whole-collection read. `getActiveLocations` uses it; nothing else does.
        get: async () => ({
            docs: name === 'locations'
                ? Object.entries(locations).map(([id, data]) => ({ id, data: () => data }))
                : [],
        }),
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
        /**
         * TWO QUERY SHAPES, and the events one has to be real.
         *
         * `rides` is a single `where('eventDate', ...)`. `events` is
         * `.where(id >= from).where(id <= to).orderBy(id)`, which `resolveCurrentEvent`
         * uses to rebuild the ride context. This fake used to return `{ docs: [] }` for
         * anything past the first `where` and had no `orderBy` on the second one at
         * all — so that read threw, was swallowed by the catch in `findCurrentEvent`,
         * and 'rewrites rideContext immediately' asserted an empty answer produced by a
         * TypeError. Honouring BOTH bounds is what makes it able to fail.
         */
        where: (field: string, op: string, value: any) => {
            if (name !== 'events') {
                return {
                    get: async () => ({
                        docs: rides.map(r => ({
                            id: r.id,
                            ref: ref(`rides/${r.id}`),
                            data: () => r.data,
                        })),
                    }),
                };
            }
            const bounds: Array<[string, any]> = [[op, value]];
            const chain: any = {
                where: (_f: string, o: string, v: any) => { bounds.push([o, v]); return chain; },
                orderBy: () => chain,
                get: async () => ({
                    docs: Object.keys(events)
                        .filter(id => bounds.every(([o, v]) =>
                            (o === '>=' ? id >= v : o === '<=' ? id <= v : true)))
                        .sort()
                        .map(id => ({ id, ref: ref(`events/${id}`), data: () => events[id] })),
                }),
            };
            return chain;
        },
    });

    db = {
        collection,
        doc: (path: string) => ({
            path,
            get: async () => {
                if (path === 'system/rideContext') {
                    return snap(true, {
                        eventId: f.contextEventId ?? null,
                        ...(f.contextByLocation ? { byLocation: f.contextByLocation } : {}),
                    });
                }
                // The weekly rule. Without it every stored document reads as an
                // override with nothing to override, and is therefore inert — so
                // the fake has to carry a schedule the way production does. Every
                // date in this file is a Friday.
                if (path === 'settings/sabhaRecurrence') {
                    return snap(f.rule !== null, f.rule ?? {
                        enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00',
                    });
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

    it('refuses a date the rule does not cover and has no document', async () => {
        // 2026-08-24 is a Monday against a Friday rule. Nothing to cancel.
        makeDb({ events: {} });
        await expect(call({ date: '2026-08-24' })).rejects.toThrow(/not on the calendar/i);
    });

    it('refuses a date already cancelled, and says which', async () => {
        makeDb({ events: { '2026-08-14': { date: '2026-08-14', status: 'cancelled' } } });
        await expect(call({ date: '2026-08-14' })).rejects.toThrow(/already cancelled/i);
    });

    it('refuses everything once the rule is off and no document exists', async () => {
        makeDb({ rule: null, events: {} });
        await expect(call({ date: '2026-08-14' })).rejects.toThrow(/not on the calendar/i);
    });

    it('CANCELS a Friday that has no document — the rule-derived case', async () => {
        // The bug this fixes. Nine of the ten rows on the manager's calendar are
        // computed from the rule and have no document, and the trash icon failed on
        // every one of them with "no longer on the calendar" for a sabha plainly
        // listed on it.
        const rec = makeDb({ events: {} });

        const result: any = await call({ date: '2026-08-14' });

        expect(result.deleted).toBe(true);
        const write = rec.sets.find(w => w.path === 'events/2026-08-14')!;
        expect(write.data.status).toBe('cancelled');
        expect(write.data.kind).toBe('override');
    });

    it('keeps a one-off\'s kind when cancelling it', async () => {
        const rec = makeDb({
            events: {
                '2026-08-14': {
                    date: '2026-08-14', kind: 'one-off', status: 'scheduled',
                    startTime: '19:00', endTime: '22:00',
                },
            },
        });

        await call({ date: '2026-08-14' });

        expect(rec.sets.find(w => w.path === 'events/2026-08-14')!.data.kind).toBe('one-off');
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
        const [recipients, title] = sendMulticast.mock.calls[0] as any[];
        // Recipients now carry the uid alongside the token — that is what makes
        // pruning a dead token possible at all.
        expect(recipients.map((r: any) => r.token).sort()).toEqual(['token-a', 'token-b']);
        expect(recipients.map((r: any) => r.uid).sort()).toEqual(['stu-a', 'stu-b']);
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

/**
 * Cancelling ONE HALL, not the whole evening.
 *
 * "in rare case scenario there might be independent changes." The dangerous direction
 * is not failing to cancel a hall — it is cancelling more than the manager asked for,
 * because everything that hangs off a gathering is keyed by event id and every one of
 * those keys had to be changed at once. A single miss deletes the founding hall's
 * attendance, or cancels the other room's riders, and neither throws.
 */
describe('deleteSabhaEvent — one hall of an evening', () => {
    const TWO_HALLS = {
        'boston-huntington': {
            name: 'Huntington Ave',
            venue: { lat: 42.339925, lng: -71.088182, address: '360 Huntington Ave' },
            active: true, order: 0,
        },
        somerville: {
            name: 'Elm Street',
            venue: { lat: 42.387, lng: -71.099, address: '5 Elm Street' },
            active: true, order: 1,
        },
    };

    it('writes the HALL\'s document, leaving the evening\'s alone', async () => {
        const rec = makeDb({ locations: TWO_HALLS });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });

        const write = rec.sets.find(s => s.path === 'events/2026-08-14__somerville')!;
        expect(write.data.status).toBe('cancelled');
        expect(write.data.locationId).toBe('somerville');
        expect(rec.sets.find(s => s.path === 'events/2026-08-14')).toBeUndefined();
    });

it('CANCELS THE FOUNDING HALL WITHOUT CANCELLING THE EVENING', async () => {
        /**
         * The case the first version of this feature got wrong, and it was not subtle.
         * `eventIdFor(date, foundingHall)` returns the BARE DATE — that is the
         * migration, and it is right for an attendance key. Used for the cancellation
         * document it writes `events/{date}`, which is the whole evening's exception:
         * every hall closed and every rider's request cancelled, from a button labelled
         * with one hall's name.
         *
         * Exception ids therefore suffix EVERY hall, founding included.
         */
        const rec = makeDb({ locations: TWO_HALLS });

        await call({ date: '2026-08-14', locationId: 'boston-huntington', acknowledge: true });

        expect(rec.sets.find(s => s.path === 'events/2026-08-14__boston-huntington')?.data.status)
            .toBe('cancelled');
        expect(rec.sets.find(s => s.path === 'events/2026-08-14')).toBeUndefined();
    });

    it('purges the founding hall\'s attendance under its BARE key', async () => {
        // The other side of the same split: the document recording the cancellation is
        // suffixed, the attendance record it orphans is not. Getting this one wrong
        // leaves the responses behind instead of deleting the wrong ones.
        const rec = makeDb({ locations: TWO_HALLS });

        await call({ date: '2026-08-14', locationId: 'boston-huntington', acknowledge: true });

        expect(rec.recursiveDeletes).toEqual(['weeklyAttendance/2026-08-14']);
    });

    it('purges EVERY hall\'s attendance when the whole evening goes', async () => {
        /**
         * `weeklyAttendance/*` responses are a subcollection Firestore leaves behind,
         * and the key is per hall. Parking only the founding hall's would leave the
         * other rooms' names, phone numbers and home addresses in Firestore with no
         * screen that could ever show them again — the first paragraph of this file's
         * header, arriving by a route the header did not know about.
         */
        const rec = makeDb({ locations: TWO_HALLS });

        await call({ date: '2026-08-14', acknowledge: true });

        const parked = rec.sets.find(s => s.path === 'system/eventGenerator')!;
        expect(parked.data.pendingAttendanceDeletes.__arrayUnion.sort())
            .toEqual(['2026-08-14', '2026-08-14__somerville']);
        expect(rec.recursiveDeletes.sort())
            .toEqual(['weeklyAttendance/2026-08-14', 'weeklyAttendance/2026-08-14__somerville']);
    });

    it('reads the founding hall\'s own exception, not the evening\'s, when cancelling it', async () => {
        // A hall already cancelled must be refused. Reading the evening's document here
        // would report the hall as open, and the second tap would write a second
        // cancellation over the first — harmless, but it would also mean the guard was
        // reading the wrong document, which is not.
        const rec = makeDb({
            locations: TWO_HALLS,
            events: {
                '2026-08-14__boston-huntington': {
                    date: '2026-08-14', kind: 'override', status: 'cancelled',
                },
            },
        });

        await expect(call({
            date: '2026-08-14', locationId: 'boston-huntington', acknowledge: true,
        })).rejects.toThrow(/already cancelled/);
        expect(rec.committed).toBe(false);
    });

    it('leaves the evening open when only the founding hall is cancelled', async () => {
        // And the mirror: with that hall's own document cancelled, the OTHER hall and
        // the evening itself are untouched.
        const rec = makeDb({
            locations: TWO_HALLS,
            events: {
                '2026-08-14__boston-huntington': {
                    date: '2026-08-14', kind: 'override', status: 'cancelled',
                },
            },
        });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });
        expect(rec.committed).toBe(true);
    });

    it('PARKS THE HALL\'S ATTENDANCE KEY, not the bare date', async () => {
        /**
         * The one that would be unrecoverable. `weeklyAttendance` is keyed by event id,
         * so parking `2026-08-14` here has the sweeper recursively delete the FOUNDING
         * hall's responses when the manager cancelled Somerville — children's names,
         * phone numbers and home addresses, for a sabha that is still happening, with
         * no screen that could ever show them again.
         */
        const rec = makeDb({ locations: TWO_HALLS });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });

        const parked = rec.sets.find(s => s.path === 'system/eventGenerator')!;
        expect(parked.data.pendingAttendanceDeletes).toEqual(
            { __arrayUnion: ['2026-08-14__somerville'] },
        );
        expect(rec.recursiveDeletes).toEqual(['weeklyAttendance/2026-08-14__somerville']);
    });

    it('cancels only the rides bound for that hall', async () => {
        const rec = makeDb({
            locations: TWO_HALLS,
            rides: [
                { id: 'r1', data: { status: 'requested', studentId: 'a', eventDate: '2026-08-14', locationId: 'somerville' } },
                { id: 'r2', data: { status: 'requested', studentId: 'b', eventDate: '2026-08-14', locationId: 'boston-huntington' } },
            ],
        });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });

        expect(rec.updates.map(u => u.path)).toEqual(['rides/r1']);
    });

    it('cancels a ride that names NO hall, rather than leaving it stranded', async () => {
        // It cannot be dispatched — isValidPendingRide refuses a ride with no hall —
        // but it is somebody's request, and a missing field must not be the reason it
        // outlives the gathering it was made for.
        const rec = makeDb({
            locations: TWO_HALLS,
            rides: [
                { id: 'r1', data: { status: 'requested', studentId: 'a', eventDate: '2026-08-14' } },
            ],
        });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });

        expect(rec.updates.map(u => u.path)).toEqual(['rides/r1']);
    });

    it('REFUSES when a driver is on the road for that hall', async () => {
        const rec = makeDb({
            locations: TWO_HALLS,
            rides: [
                { id: 'r1', data: { status: 'assigned', eventDate: '2026-08-14', locationId: 'somerville' } },
            ],
        });

        await expect(call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true }))
            .rejects.toThrow(/already assigned/);
        expect(rec.committed).toBe(false);
    });

    it('is NOT blocked by a driver on the road for the other hall', async () => {
        // The mirror of the case above, and the reason the filter is in memory rather
        // than a `where`: an equality filter on `locationId` returns EMPTY for rides
        // that predate the field, so this guard would read "nobody is mid-route" and
        // let the cancellation through under a driver already carrying children.
        const rec = makeDb({
            locations: TWO_HALLS,
            rides: [
                { id: 'r1', data: { status: 'assigned', eventDate: '2026-08-14', locationId: 'boston-huntington' } },
            ],
        });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });
        expect(rec.committed).toBe(true);
    });

    it('refuses a hall that is not open', async () => {
        // Loud, not a silent widening to the whole evening: a stale tab whose hall a
        // manager has since retired must not turn one tap into cancelling both rooms.
        const rec = makeDb({ locations: TWO_HALLS });

        await expect(call({ date: '2026-08-14', locationId: 'brookline', acknowledge: true }))
            .rejects.toThrow(/not open/);
        expect(rec.committed).toBe(false);
    });

    it('refuses a hall id that could not be a document id', async () => {
        const rec = makeDb({ locations: TWO_HALLS });

        await expect(call({ date: '2026-08-14', locationId: '../system', acknowledge: true }))
            .rejects.toThrow(/not valid/);
        expect(rec.committed).toBe(false);
    });

    it('cancels a hall running purely on the rule, with no document of its own', async () => {
        // Almost every evening. Reading only the hall's own document would report "not
        // on the calendar" for a hall that is plainly listed on it — the dead-control
        // failure this file already carries one scar from.
        const rec = makeDb({ locations: TWO_HALLS, events: {} });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });
        expect(rec.committed).toBe(true);
    });

    it('refuses a hall whose evening is already cancelled date-wide', async () => {
        const rec = makeDb({
            locations: TWO_HALLS,
            events: { '2026-08-14': { date: '2026-08-14', kind: 'override', status: 'cancelled' } },
        });

        await expect(call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true }))
            .rejects.toThrow(/not on the calendar|already cancelled/);
        expect(rec.committed).toBe(false);
    });

    it('names the hall in the notification, so a rider knows which sabha is off', async () => {
        // Without it this push tells a rider the sabha is cancelled while the other
        // room is still meeting, and the correction is a phone call somebody has to
        // make.
        makeDb({
            locations: TWO_HALLS,
            responses: ['stu-a'],
            users: { 'stu-a': { fcmToken: 'tok-a' } },
        });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });

        expect(sendMulticast).toHaveBeenCalled();
        const [, , body] = sendMulticast.mock.calls[0] as any[];
        expect(body).toContain('Elm Street');
    });

    it('does not name a hall when the whole evening is cancelled', async () => {
        makeDb({
            locations: TWO_HALLS,
            responses: ['stu-a'],
            users: { 'stu-a': { fcmToken: 'tok-a' } },
        });

        await call({ date: '2026-08-14', acknowledge: true });

        const [, , body] = sendMulticast.mock.calls[0] as any[];
        expect(body).not.toContain('Elm Street');
    });

    it('echoes the hall back in the preview, so the dialog can name it', async () => {
        makeDb({ locations: TWO_HALLS });

        const preview: any = await call({
            date: '2026-08-14', locationId: 'somerville', dryRun: true,
        });

        expect(preview.locationId).toBe('somerville');
        expect(preview.locationName).toBe('Elm Street');
    });

    it('reads isCurrentEvent from THAT HALL\'S slice', async () => {
        // Against the top level this says false for a second hall's gathering — and
        // isCurrentEvent is what decides whether rideContext is rewritten in the same
        // commit. A false leaves the document naming a sabha that was just cancelled,
        // with its request window still open, until the next minute tick.
        makeDb({
            locations: TWO_HALLS,
            contextEventId: '2026-08-14',
            contextByLocation: {
                'boston-huntington': { eventId: '2026-08-14' },
                somerville: { eventId: '2026-08-14__somerville' },
            },
        });

        const preview: any = await call({
            date: '2026-08-14', locationId: 'somerville', dryRun: true,
        });

        expect(preview.isCurrentEvent).toBe(true);
    });

    it('rewrites the WHOLE context document, keeping byLocation and locationIds', async () => {
        /**
         * This was a partial `set` of the top-level fields, which erased `byLocation`
         * and `locationIds` until the next minute tick. A client reading its own hall's
         * slice then fell back to the aggregate, so for up to a minute every hall showed
         * the founding hall's window — and a client that had learned to expect
         * `locationIds` could no longer tell "my hall is closed" from "my hall is not
         * described here", which is the distinction that field exists for.
         */
        const rec = makeDb({
            locations: TWO_HALLS,
            // Today (the 7th) is cancelled, so the 14th really is the current
            // gathering. Without that the resolver answers for the 7th and the pending
            // cancellation lands on a different evening — which is how this test first
            // failed, and the failure was right.
            events: { '2026-08-07': { date: '2026-08-07', kind: 'override', status: 'cancelled' } },
            contextEventId: '2026-08-14',
            contextByLocation: {
                'boston-huntington': { eventId: '2026-08-14' },
                somerville: { eventId: '2026-08-14__somerville' },
            },
        });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });

        const ctx = rec.sets.find(s => s.path === 'system/rideContext')!;
        expect(Object.keys(ctx.data.byLocation).sort())
            .toEqual(['boston-huntington', 'somerville']);
        expect(ctx.data.locationIds.sort()).toEqual(['boston-huntington', 'somerville']);

        // Somerville is the hall just cancelled, so its slice goes quiet — while the
        // evening itself, and the other hall, carry on untouched.
        expect(ctx.data.byLocation.somerville.calendarStatus).toBe('no-scheduled-event');
        expect(ctx.data.byLocation['boston-huntington'].eventId).toBe('2026-08-14');
    });

it('rolls EVERY hall forward when the whole evening is cancelled', async () => {
        // The other direction. Cancelling the evening leaves no hall on that date, so
        // both slices move to the next one — and both must name their own event id.
        const rec = makeDb({
            locations: TWO_HALLS,
            events: { '2026-08-07': { date: '2026-08-07', kind: 'override', status: 'cancelled' } },
            contextEventId: '2026-08-14',
            contextByLocation: {
                'boston-huntington': { eventId: '2026-08-14' },
                somerville: { eventId: '2026-08-14__somerville' },
            },
        });

        await call({ date: '2026-08-14', acknowledge: true });

        const ctx = rec.sets.find(s => s.path === 'system/rideContext')!;
        expect(ctx.data.byLocation['boston-huntington'].eventId).toBe('2026-08-21');
        expect(ctx.data.byLocation.somerville.eventId).toBe('2026-08-21__somerville');
    });

    it('names the hall on the audit row', async () => {
        const rec = makeDb({ locations: TWO_HALLS });

        await call({ date: '2026-08-14', locationId: 'somerville', acknowledge: true });

        const audit = rec.sets.find(s => s.path.startsWith('auditLogs/'))
            ?? rec.sets.find(s => s.data?.action === 'event.delete');
        expect(audit?.data.summary).toContain('Elm Street');
        expect(audit?.data.details.locationId).toBe('somerville');
        expect(audit?.data.targetDocumentId).toBe('2026-08-14__somerville');
    });
});
