/**
 * Setting the pattern is a manager action, and the watermark is not theirs to move.
 *
 * `generatedThrough` is the only thing keeping a deleted date deleted. If a client
 * could send it, a manager could roll it back — accidentally or otherwise — and
 * every date they had removed would reappear on the next run. So it is read from
 * the stored document and carried across, never taken from the request.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
const assertApprovedManager = vi.fn(async (_db: any, _uid: string, _action: string) => undefined);

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
    firestore: Object.assign(() => db, { FieldPath: { documentId: () => '__name__' } }),
}));
vi.mock('../utils/authz', () => ({
    assertApprovedManager: (db: any, uid: string, action: string) =>
        assertApprovedManager(db, uid, action),
}));
vi.mock('../utils/settings', () => ({ getTimeZone: async () => 'America/New_York' }));
vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn(async () => null) }));

import { updateSabhaRecurrence, topUpCalendar, RECURRENCE_DOC } from './sabhaRecurrence';

interface Recorder {
    creates: Array<{ path: string; data: any }>;
    sets: Array<{ path: string; data: any }>;
    /** Direct (non-batch) document writes — where the pattern itself is saved. */
    saved: Array<{ path: string; data: any }>;
}

function makeDb(opts: { stored?: any; existingEvents?: string[] } = {}) {
    const rec: Recorder = { creates: [], sets: [], saved: [] };
    const events = opts.existingEvents ?? [];

    const docRef = (path: string) => ({
        path,
        get: async () => ({
            exists: path === RECURRENCE_DOC ? opts.stored !== undefined : false,
            data: () => (path === RECURRENCE_DOC ? opts.stored : undefined),
        }),
        set: async (data: any) => { rec.saved.push({ path, data }); },
    });

    db = {
        doc: docRef,
        collection: (name: string) => {
            const chain: any = {
                doc: (id: string) => docRef(`${name}/${id}`),
                where: () => chain,
                get: async () => ({ docs: events.map(id => ({ id })) }),
            };
            return chain;
        },
        batch: () => ({
            create: (ref: any, data: any) => rec.creates.push({ path: ref.path, data }),
            set: (ref: any, data: any) => rec.sets.push({ path: ref.path, data }),
            update: (ref: any, data: any) => rec.sets.push({ path: ref.path, data }),
            commit: async () => undefined,
        }),
    };
    return rec;
}

const GOOD = { enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00', weeksAhead: 2 };
const ctx = { auth: { uid: 'mgr_1' } };
const call = (data: any) => (updateSabhaRecurrence as any)(data, ctx);

beforeEach(() => {
    vi.clearAllMocks();
    assertApprovedManager.mockResolvedValue(undefined);
});

describe('updateSabhaRecurrence — authorisation', () => {
    it('refuses an unauthenticated caller', async () => {
        makeDb();
        await expect((updateSabhaRecurrence as any)(GOOD, {})).rejects.toThrow(/authenticated/i);
    });

    it('goes through assertApprovedManager', async () => {
        makeDb();
        await call(GOOD);
        expect(assertApprovedManager).toHaveBeenCalledWith(db, 'mgr_1', 'change the sabha schedule');
    });

    it('does not write when the manager check throws', async () => {
        const rec = makeDb();
        assertApprovedManager.mockRejectedValue(new Error('not a manager'));

        await expect(call(GOOD)).rejects.toThrow(/not a manager/);
        expect(rec.creates).toEqual([]);
    });
});

describe('updateSabhaRecurrence — validation', () => {
    it('refuses a pattern with no days', async () => {
        makeDb();
        await expect(call({ ...GOOD, daysOfWeek: [] })).rejects.toThrow(/at least one day/i);
    });

    it('refuses an end time at or before the start', async () => {
        makeDb();
        await expect(call({ ...GOOD, startTime: '22:00', endTime: '19:00' }))
            .rejects.toThrow(/later than the start/i);
    });

    it('refuses a horizon outside the allowed range', async () => {
        makeDb();
        await expect(call({ ...GOOD, weeksAhead: 500 })).rejects.toThrow(/between 1 and 26/i);
        await expect(call({ ...GOOD, weeksAhead: 0 })).rejects.toThrow(/between 1 and 26/i);
    });
});

describe('updateSabhaRecurrence — the watermark is server-owned', () => {
    it('ignores a generatedThrough sent by the client', async () => {
        // The attack this closes: rolling the mark back re-opens every date the
        // manager had deleted.
        const rec = makeDb({ stored: { generatedThrough: '2026-12-31' } });

        await call({ ...GOOD, generatedThrough: '2020-01-01' });

        const mark = rec.sets.find(s => s.path === RECURRENCE_DOC)!.data.generatedThrough;
        expect(mark).toBe('2026-12-31');
    });

    it('keeps the stored mark, so deleted dates stay deleted', async () => {
        const rec = makeDb({ stored: { generatedThrough: '2026-12-31' } });

        await call(GOOD);

        // Nothing inside the horizon can be created, because the mark is beyond it.
        expect(rec.creates).toEqual([]);
    });

    it('starts from nothing when no mark is stored yet', async () => {
        const rec = makeDb();

        const result = await call(GOOD);

        expect(result.created.length).toBeGreaterThan(0);
        expect(rec.creates.length).toBe(result.created.length);
    });
});

describe('updateSabhaRecurrence — saving takes effect immediately', () => {
    it('creates the missing dates rather than waiting for 03:00', async () => {
        // A setting whose effect is invisible until tomorrow is one nobody trusts.
        const rec = makeDb();

        const result = await call(GOOD);

        expect(result.created.length).toBeGreaterThan(0);
        for (const c of rec.creates) {
            expect(c.path.startsWith('events/')).toBe(true);
            expect(c.data.status).toBe('scheduled');
            expect(c.data.fromRecurrence).toBe(true);
            expect(c.data.startTime).toBe('19:00');
        }
    });

    it('creates nothing while disabled, but STILL saves the pattern', async () => {
        // Turning it off must persist. A save button that quietly saves nothing
        // is this codebase's oldest failure mode.
        const rec = makeDb();

        const result = await call({ ...GOOD, enabled: false });

        expect(result.created).toEqual([]);
        expect(rec.creates).toEqual([]);

        const saved = rec.saved.find(s => s.path === RECURRENCE_DOC);
        expect(saved).toBeDefined();
        expect(saved!.data.enabled).toBe(false);
        expect(saved!.data.daysOfWeek).toEqual([5]);
    });

    it('records who changed it and when', async () => {
        const rec = makeDb();

        await call(GOOD);

        const saved = rec.saved.find(s => s.path === RECURRENCE_DOC)!;
        expect(saved.data.updatedBy).toBe('mgr_1');
        expect(saved.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('topUpCalendar', () => {
    const config = {
        enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00',
        weeksAhead: 2, generatedThrough: null,
    };
    const NOW = new Date('2026-08-15T16:00:00Z');

    it('skips dates that already hold a document', async () => {
        const rec = makeDb({ existingEvents: ['2026-08-21'] });

        const created = await topUpCalendar(db, config, NOW, 'America/New_York');

        expect(created).not.toContain('2026-08-21');
        expect(rec.creates.map(c => c.path)).not.toContain('events/2026-08-21');
    });

    it('moves the watermark even when it created nothing', async () => {
        // Otherwise a horizon the manager already filled by hand leaves the mark
        // short, and those dates are offered again for ever.
        const rec = makeDb({ existingEvents: ['2026-08-21', '2026-08-28'] });

        const created = await topUpCalendar(db, config, NOW, 'America/New_York');

        expect(created).toEqual([]);
        expect(rec.sets.find(s => s.path === RECURRENCE_DOC)!.data.generatedThrough)
            .toBe('2026-08-29');
    });

    it('does nothing at all while disabled', async () => {
        const rec = makeDb();

        expect(await topUpCalendar(db, { ...config, enabled: false }, NOW, 'America/New_York'))
            .toEqual([]);
        expect(rec.creates).toEqual([]);
        expect(rec.sets).toEqual([]);
    });
});
