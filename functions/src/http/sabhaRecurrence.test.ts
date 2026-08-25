/**
 * Setting the recurring sabha now stores a rule and nothing else.
 *
 * WHAT THESE TESTS USED TO GUARD, AND WHY IT IS GONE
 * -------------------------------------------------
 * The previous version of this suite spent most of its cases on
 * `generatedThrough`, the high-water mark that stopped a deleted date being
 * regenerated — including one asserting that a client could not roll it back and
 * resurrect every date a manager had removed.
 *
 * None of that exists any more. `topUpCalendar` is deleted and nothing is
 * materialised, so there is no watermark to protect and nothing to resurrect. The
 * cases are removed rather than ported, and the one that mattered most is
 * preserved as a ratchet: the callable must NOT write a horizon or a watermark,
 * because a stored value read by anything not yet updated would quietly bring the
 * generator's behaviour back.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
const assertApprovedManager = vi.fn(async (_db: any, _uid: string, _action: string) => undefined);
const writeAuditLog = vi.fn(async () => null);

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
    firestore: Object.assign(() => db, {
        FieldPath: { documentId: () => '__name__' },
        FieldValue: { delete: () => '__DELETE__' },
    }),
}));
vi.mock('../utils/authz', () => ({
    assertApprovedManager: (d: any, u: string, a: string) => assertApprovedManager(d, u, a),
}));
vi.mock('../utils/audit', () => ({ writeAuditLog: (..._a: any[]) => writeAuditLog() }));

import { updateSabhaRecurrence, readRecurrence, describeRule, RECURRENCE_DOC } from './sabhaRecurrence';

const DELETE = '__DELETE__';

/**
 * The world the callable now reads: who has booked what, and on which dates.
 *
 * Empty by default, so every case written before the reconciliation existed still
 * describes a project where nobody has booked anything and it is a no-op.
 */
interface World {
    /** date -> rows of `weeklyAttendance/{date}/responses`. */
    attendance?: Record<string, Array<{ id: string; data: any }>>;
    rides?: Array<{ id: string; data: any }>;
    /** date -> exception document in `events`. */
    events?: Record<string, any>;
}

function makeDb(stored?: any, world: World = {}) {
    const attendance = world.attendance ?? {};
    const rides = world.rides ?? [];
    const events = world.events ?? {};

    // Every write lands here whatever collection it was aimed at, so a test can
    // assert on the rule and on a moved rider through the same channel.
    const saved: Array<{ path: string; data: any; op?: string }> = [];

    const responsesOf = (date: string) => ({
        get: async () => {
            const rows = attendance[date] ?? [];
            return {
                size: rows.length,
                docs: rows.map(r => ({
                    id: r.id,
                    data: () => r.data,
                    ref: {
                        delete: async () => {
                            saved.push({ path: `weeklyAttendance/${date}/responses/${r.id}`, data: r.data, op: 'delete' });
                        },
                    },
                })),
            };
        },
        limit: () => ({ get: async () => ({ size: (attendance[date] ?? []).length }) }),
        doc: (id: string) => ({
            get: async () => ({ exists: (attendance[date] ?? []).some(r => r.id === id) }),
            set: async (data: any) => {
                saved.push({ path: `weeklyAttendance/${date}/responses/${id}`, data, op: 'set' });
            },
        }),
    });

    db = {
        doc: (path: string) => ({
            path,
            get: async () => ({
                exists: path === RECURRENCE_DOC ? stored !== undefined : false,
                data: () => (path === RECURRENCE_DOC ? stored : undefined),
            }),
            set: async (data: any) => { saved.push({ path, data }); },
        }),
        collection: (name: string) => ({
            doc: (id: string) => ({
                path: `${name}/${id}`,
                id,
                get: async () => ({
                    exists: name === 'events' ? events[id] !== undefined : false,
                    data: () => (name === 'events' ? events[id] : undefined),
                }),
                collection: (_sub: string) => responsesOf(id),
            }),
            listDocuments: async () => Object.keys(attendance).map(date => ({
                id: date,
                collection: (_sub: string) => responsesOf(date),
            })),
            where: (field: string, op: string, value: any) => ({
                get: async () => {
                    const matched = rides.filter(r => (op === 'in'
                        ? value.includes(r.data[field])
                        : r.data[field] === value));
                    return {
                        size: matched.length,
                        docs: matched.map(r => ({
                            id: r.id,
                            data: () => r.data,
                            ref: {
                                update: async (patch: any) => {
                                    saved.push({ path: `rides/${r.id}`, data: patch, op: 'update' });
                                    Object.assign(r.data, patch);
                                },
                            },
                        })),
                    };
                },
            }),
        }),
    };
    return saved;
}

const GOOD = { enabled: true, daysOfWeek: [5], startTime: '19:30', endTime: '22:00' };
const call = (data: any) => (updateSabhaRecurrence as any)(data, { auth: { uid: 'mgr_1' } });
const rule = (saved: Array<{ path: string; data: any }>) =>
    saved.find(s => s.path === RECURRENCE_DOC)!.data;

beforeEach(() => {
    vi.clearAllMocks();
    assertApprovedManager.mockResolvedValue(undefined);
});

describe('authorisation', () => {
    it('refuses an unauthenticated caller', async () => {
        makeDb();
        await expect((updateSabhaRecurrence as any)(GOOD, {})).rejects.toThrow(/authenticated/i);
    });

    it('goes through assertApprovedManager', async () => {
        makeDb();
        await call(GOOD);
        expect(assertApprovedManager).toHaveBeenCalledWith(db, 'mgr_1', 'change the sabha schedule');
    });

    it('writes nothing when the manager check throws', async () => {
        const saved = makeDb();
        assertApprovedManager.mockRejectedValue(new Error('not a manager'));

        await expect(call(GOOD)).rejects.toThrow(/not a manager/);
        expect(saved).toEqual([]);
    });
});

describe('validation', () => {
    it('refuses a pattern with no days', async () => {
        makeDb();
        await expect(call({ ...GOOD, daysOfWeek: [] })).rejects.toThrow(/at least one day/i);
    });

    it('refuses an end time at or before the start', async () => {
        makeDb();
        await expect(call({ ...GOOD, startTime: '22:00', endTime: '19:30' }))
            .rejects.toThrow(/later than the start/i);
    });

    it('validates through the same function the scheduler reads with', async () => {
        // A rule the scheduler would refuse must not be saveable, or the manager
        // sees a stored setting that silently schedules nothing.
        makeDb();
        await expect(call({ ...GOOD, startTime: '25:99' })).rejects.toThrow(/later than the start/i);
    });
});

describe('storing the rule', () => {
    it('saves the pattern', async () => {
        const saved = makeDb();

        await call(GOOD);

        expect(rule(saved)).toMatchObject({
            enabled: true, daysOfWeek: [5], startTime: '19:30', endTime: '22:00',
        });
    });

    it('records who changed it and when', async () => {
        const saved = makeDb();

        await call(GOOD);

        expect(rule(saved).updatedBy).toBe('mgr_1');
        expect(rule(saved).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('turning it off persists', async () => {
        // A save button that quietly saves nothing is this repo's oldest bug.
        const saved = makeDb();

        await call({ ...GOOD, enabled: false });

        expect(rule(saved).enabled).toBe(false);
        expect(rule(saved).daysOfWeek).toEqual([5]);
    });

    it('accepts several days a week', async () => {
        const saved = makeDb();

        await call({ ...GOOD, daysOfWeek: [0, 5] });

        expect(rule(saved).daysOfWeek).toEqual([0, 5]);
    });

    it('records an audit row', async () => {
        makeDb();
        await call(GOOD);
        expect(writeAuditLog).toHaveBeenCalledTimes(1);
    });
});

describe('the generator stays deleted', () => {
    it('never stores a horizon or a watermark — it REMOVES them', async () => {
        // The ratchet. A stored `weeksAhead` or `generatedThrough` read by
        // anything not yet updated would quietly restore the old behaviour, so
        // saving actively deletes both rather than merely omitting them.
        const saved = makeDb({ weeksAhead: 10, generatedThrough: '2026-10-26' });

        await call(GOOD);

        expect(rule(saved).weeksAhead).toBe(DELETE);
        expect(rule(saved).generatedThrough).toBe(DELETE);
    });

    it('ignores a horizon sent by a client', async () => {
        const saved = makeDb();

        await call({ ...GOOD, weeksAhead: 26, generatedThrough: '2027-01-01' });

        expect(rule(saved).weeksAhead).toBe(DELETE);
        expect(rule(saved).generatedThrough).toBe(DELETE);
    });

    it('creates no event documents at all', async () => {
        // The whole point. Saving a schedule writes one document: the rule.
        const saved = makeDb();

        await call(GOOD);

        expect(saved.map(s => s.path)).toEqual([RECURRENCE_DOC]);
    });

    it('returns the rule, not a list of created dates', async () => {
        makeDb();

        const result = await call(GOOD);

        expect(result.rule).toMatchObject({ daysOfWeek: [5] });
        expect(result.created).toBeUndefined();
    });
});

describe('readRecurrence', () => {
    it('returns null when nothing is stored', async () => {
        makeDb();
        expect(await readRecurrence(db)).toBeNull();
    });

    it('returns null for a stored rule that cannot be understood', async () => {
        makeDb({ enabled: true, daysOfWeek: [], startTime: '19:30', endTime: '22:00' });
        expect(await readRecurrence(db)).toBeNull();
    });

    it('ignores a leftover horizon on a stored rule', async () => {
        makeDb({ ...GOOD, weeksAhead: 10, generatedThrough: '2026-10-26' });

        const out = await readRecurrence(db) as unknown as Record<string, unknown>;

        expect(out.weeksAhead).toBeUndefined();
        expect(out.generatedThrough).toBeUndefined();
        expect(out.daysOfWeek).toEqual([5]);
    });
});

describe('describeRule', () => {
    it('reads as a schedule, for the audit row and the screen', () => {
        expect(describeRule({
            enabled: true, daysOfWeek: [5], startTime: '19:30', endTime: '22:00',
            venue: null, agenda: '',
        })).toBe('Every Friday, 19:30–22:00');
    });

    it('names every day when there are several', () => {
        expect(describeRule({
            enabled: true, daysOfWeek: [0, 5], startTime: '19:30', endTime: '22:00',
            venue: null, agenda: '',
        })).toMatch(/Sunday, Friday/);
    });

    it('says plainly when it is off', () => {
        expect(describeRule({
            enabled: false, daysOfWeek: [5], startTime: '19:30', endTime: '22:00',
            venue: null, agenda: '',
        })).toMatch(/turned off/i);
    });
});

/**
 * Changing the day must not strand the people who already booked the old one.
 *
 * The bug, in production on 2026-08-24: the day moved Friday -> Monday, and two
 * riders who had answered "yes" for Friday the 28th stayed attached to it. The
 * gathering that actually ran counted nobody, and one of the two also held a ride
 * request on a date dispatch could never serve — `globalAssignDriver` queries
 * status with no date filter, so it would never have been picked up, and
 * `expireStaleRequests` would not clear it either because that only touches
 * gatherings strictly in the PAST.
 *
 * Dates are 2027 so the cases keep describing the future however long this suite
 * lives. 01-08 and 01-15 are Fridays; 01-11 and 01-18 are Mondays.
 */
describe('bookings the new rule would strand', () => {
    const MONDAYS = { enabled: true, daysOfWeek: [1], startTime: '20:30', endTime: '22:00' };

    const rider = (id: string, name: string) => ({ id, data: { studentName: name, response: 'yes' } });
    const ride = (id: string, name: string, eventDate: string) =>
        ({ id, data: { studentName: name, eventDate, status: 'requested', timeSlot: '7:30 PM' } });

    /**
     * Two people booked onto Friday 2027-01-08, which Mondays-only removes.
     *
     * A FUNCTION, not a shared object. The fake applies ride updates in place, so
     * one shared fixture let an earlier case move the ride and left every later
     * case describing a rider who was already on the Monday — passing, or failing,
     * for a reason that had nothing to do with the code under test.
     */
    const FRIDAY_BOOKINGS = () => ({
        attendance: { '2027-01-08': [rider('u1', 'Tarak'), rider('u2', 'Vidhyut')] },
        rides: [ride('r1', 'Tarak', '2027-01-08')],
    });

    it('reports who would be stranded without writing anything', async () => {
        const saved = makeDb(undefined, FRIDAY_BOOKINGS());

        const result: any = await call({ ...MONDAYS, dryRun: true });

        expect(result.stranded).toHaveLength(1);
        expect(result.stranded[0]).toMatchObject({
            date: '2027-01-08',
            target: '2027-01-11',      // the next Monday ON OR AFTER their date
            responseCount: 2,
            requestedRideCount: 1,
        });
        expect(result.stranded[0].names).toEqual(expect.arrayContaining(['Tarak', 'Vidhyut']));
        // A preview that saved the rule would be a trap: the manager is still deciding.
        expect(saved).toEqual([]);
    });

    it('refuses to save without an acknowledgement', async () => {
        const saved = makeDb(undefined, FRIDAY_BOOKINGS());

        await expect(call(MONDAYS)).rejects.toThrow(/already booked/i);
        expect(saved).toEqual([]);
    });

    it('moves responses and ride requests once acknowledged', async () => {
        const saved = makeDb(undefined, FRIDAY_BOOKINGS());

        await call({ ...MONDAYS, acknowledge: true });

        // Both responses land on the Monday, carrying the new eventId.
        const written = saved.filter(s => s.op === 'set'
            && s.path.startsWith('weeklyAttendance/2027-01-11/responses/'));
        expect(written.map(s => s.path)).toEqual([
            'weeklyAttendance/2027-01-11/responses/u1',
            'weeklyAttendance/2027-01-11/responses/u2',
        ]);
        expect(written[0].data.eventId).toBe('2027-01-11');

        // And are removed from the Friday, not left in both places.
        expect(saved.filter(s => s.op === 'delete'
            && s.path.startsWith('weeklyAttendance/2027-01-08/'))).toHaveLength(2);

        expect(saved.find(s => s.path === 'rides/r1')?.data)
            .toMatchObject({ date: '2027-01-11', eventDate: '2027-01-11' });
    });

    it('retimes a moved ride to the new week, so the rider is not told the old hour', async () => {
        const saved = makeDb(undefined, FRIDAY_BOOKINGS());

        await call({ ...MONDAYS, acknowledge: true });

        expect(saved.find(s => s.path === 'rides/r1')?.data.timeSlot).toBe('8:30 PM');
    });

    it('saves straight through when nobody has booked anything', async () => {
        const saved = makeDb();

        const result: any = await call(MONDAYS);

        expect(result.stranded).toEqual([]);
        expect(rule(saved).daysOfWeek).toEqual([1]);
    });

    it('leaves a booking alone when its date is still a sabha', async () => {
        const saved = makeDb(undefined, {
            attendance: { '2027-01-11': [rider('u1', 'Tarak')] },   // already a Monday
        });

        const result: any = await call(MONDAYS);

        expect(result.stranded).toEqual([]);
        expect(saved.some(s => s.op === 'delete')).toBe(false);
    });

    it('does not strand a one-off standing on a date the rule never covers', async () => {
        // The rule not covering it is the entire point of a one-off. Flagging it
        // would ask the manager to move people off a sabha that is going ahead.
        makeDb(undefined, {
            attendance: { '2027-01-08': [rider('u1', 'Tarak')] },
            events: {
                '2027-01-08': {
                    kind: 'one-off', status: 'scheduled',
                    startTime: '19:00', endTime: '21:00',
                },
            },
        });

        const result: any = await call({ ...MONDAYS, dryRun: true });

        expect(result.stranded).toEqual([]);
    });

    it('strands a date the manager already cancelled, so nobody waits for it', async () => {
        makeDb(undefined, {
            attendance: { '2027-01-11': [rider('u1', 'Tarak')] },   // a Monday...
            events: { '2027-01-11': { kind: 'override', status: 'cancelled', startTime: '20:30', endTime: '22:00' } },
        });

        const result: any = await call({ ...MONDAYS, dryRun: true });

        expect(result.stranded).toHaveLength(1);
        expect(result.stranded[0]).toMatchObject({ date: '2027-01-11', target: '2027-01-18' });
    });

    it('closes ride requests instead when repeating is turned off', async () => {
        const saved = makeDb(undefined, FRIDAY_BOOKINGS());

        await call({ ...MONDAYS, enabled: false, acknowledge: true });

        // Nowhere to move them to, so the request is cancelled rather than left in
        // the dispatcher's queue for a gathering that will never happen.
        expect(saved.find(s => s.path === 'rides/r1')?.data.status).toBe('cancelled');
        // The responses stay: keyed by date they mislead nobody, and deleting them
        // would destroy the only record that these people said they were coming.
        expect(saved.some(s => s.op === 'delete')).toBe(false);
    });

    it('never overwrites an answer already given for the destination', async () => {
        const saved = makeDb(undefined, {
            attendance: {
                '2027-01-08': [rider('u1', 'Tarak')],
                '2027-01-11': [rider('u1', 'Tarak')],   // already answered for the Monday
            },
        });

        await call({ ...MONDAYS, acknowledge: true });

        expect(saved.some(s => s.op === 'set'
            && s.path === 'weeklyAttendance/2027-01-11/responses/u1')).toBe(false);
    });
});
