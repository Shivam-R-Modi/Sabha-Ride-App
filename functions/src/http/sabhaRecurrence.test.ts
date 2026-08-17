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
vi.mock('../utils/audit', () => ({ writeAuditLog: (...a: any[]) => writeAuditLog() }));

import { updateSabhaRecurrence, readRecurrence, describeRule, RECURRENCE_DOC } from './sabhaRecurrence';

const DELETE = '__DELETE__';

function makeDb(stored?: any) {
    const saved: Array<{ path: string; data: any }> = [];

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
            doc: (id: string) => ({ path: `${name}/${id}` }),
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
