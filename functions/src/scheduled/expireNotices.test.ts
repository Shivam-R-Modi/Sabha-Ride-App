/**
 * Taking notices down, and taking their images with them.
 *
 * The owner's requirement was explicit: an expired notice must be DELETED, not
 * hidden, "so that image storage doesn't fill up if it accumulates". So the two
 * things worth testing are the date boundary and the deletion ORDER.
 *
 * The boundary is timezone-sensitive. Comparing in UTC would take an evening
 * notice down five hours early on the east coast — during the very sabha it was
 * advertising — which is why this uses `zonedDateKey` and not
 * `toISOString().slice(0, 10)`. (`managerBroadcast` buckets its daily count in
 * UTC; that is a separate, smaller thing.)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('firebase-functions', () => ({
    pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (h: any) => h }) }) },
}));

let db: any;
let deleted: string[];
let agendaUpdates: Array<{ id: string; data: any }>;
/** Whatever the mocked FieldValue.delete() returns. Read only inside test bodies. */
const AGENDA_DELETED = '__FIELD_DELETE__';
// `firestore` is callable AND carries FieldPath/FieldValue, because this handler
// now also runs `clearPastAgendas`, which uses both. With the bare `() => db`
// mock that step threw on every run and was swallowed by its own catch — ten
// tests passed while half the handler silently did nothing.
//
// Everything is built INSIDE the factory: vi.mock is hoisted above the consts
// below, so referencing one from here is a use-before-initialisation error.
vi.mock('firebase-admin', () => {
    const firestore: any = () => db;
    firestore.FieldPath = { documentId: () => '__name__' };
    firestore.FieldValue = { delete: () => '__FIELD_DELETE__' };
    return { firestore };
});

const deleteImage = vi.fn(async (..._a: any[]) => true);
vi.mock('../utils/noticeStorage', () => ({
    deleteNoticeImage: (...a: any[]) => deleteImage(...(a as [])),
}));

import { expireNotices, noticeIsPast } from './expireNotices';

/**
 * Tagged by collection name. An untagged mock that answers every collection with
 * the same shape is how the notice board's subscription once captured the rides
 * listener in DriverDashboard.test.tsx and made nine tests drive the wrong thing.
 */
function makeDb(
    notices: Array<{ id: string; data: any }>,
    events: Array<{ id: string; data: any }> = [],
) {
    deleted = [];
    agendaUpdates = [];
    db = {
        collection: (name: string) => {
            if (name === 'events') {
                return {
                    where: () => ({
                        get: async () => ({
                            docs: events.map(e => ({
                                id: e.id,
                                data: () => e.data,
                                ref: {
                                    update: async (data: any) => { agendaUpdates.push({ id: e.id, data }); },
                                },
                            })),
                        }),
                    }),
                };
            }
            return {
                get: async () => ({
                    docs: notices.map(n => ({
                        id: n.id,
                        data: () => n.data,
                        ref: { delete: async () => { deleted.push(n.id); } },
                    })),
                }),
            };
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    deleteImage.mockResolvedValue(true);
});

describe('noticeIsPast', () => {
    it('keeps a notice for the whole of its own day', () => {
        // A flyer for an 8:30pm event on the 21st must still be up ON the 21st.
        expect(noticeIsPast({ showUntil: '2026-08-21' }, '2026-08-21')).toBe(false);
    });

    it('drops it the day after', () => {
        expect(noticeIsPast({ showUntil: '2026-08-21' }, '2026-08-22')).toBe(true);
    });

    it('falls back to the linked sabha date', () => {
        // So a manager can tie a notice to a sabha without also picking a date.
        expect(noticeIsPast({ eventId: '2026-08-14' }, '2026-08-22')).toBe(true);
        expect(noticeIsPast({ eventId: '2026-08-28' }, '2026-08-22')).toBe(false);
    });

    it('prefers showUntil when both are set', () => {
        expect(noticeIsPast({ showUntil: '2026-08-28', eventId: '2026-08-14' }, '2026-08-22')).toBe(false);
    });

    it('keeps a dateless notice for ever, until a manager removes it', () => {
        expect(noticeIsPast({}, '2026-08-22')).toBe(false);
        expect(noticeIsPast({ showUntil: null, eventId: null }, '2026-08-22')).toBe(false);
    });
});

describe('expireNotices', () => {
    it('deletes the image BEFORE the document', async () => {
        // The other order loses the only reference to the object and orphans it.
        const order: string[] = [];
        deleteImage.mockImplementation(async () => { order.push('image'); return true; });
        makeDb([{ id: 'n1', data: { showUntil: '2020-01-01', imagePath: 'notices/n1/f.jpg' } }]);
        db.collection = () => ({
            get: async () => ({
                docs: [{
                    id: 'n1',
                    data: () => ({ showUntil: '2020-01-01', imagePath: 'notices/n1/f.jpg' }),
                    ref: { delete: async () => { order.push('doc'); } },
                }],
            }),
        });

        await (expireNotices as any)();

        expect(order).toEqual(['image', 'doc']);
    });

    it('leaves a live notice alone', async () => {
        makeDb([{ id: 'live', data: { showUntil: '2999-01-01' } }]);
        await (expireNotices as any)();

        expect(deleted).toEqual([]);
        expect(deleteImage).not.toHaveBeenCalled();
    });

    it('still removes the document when the image cannot be deleted', async () => {
        // Otherwise a Storage outage pins an expired notice to every dashboard.
        deleteImage.mockResolvedValue(false);
        makeDb([{ id: 'n1', data: { showUntil: '2020-01-01', imagePath: 'notices/n1/f.jpg' } }]);

        await (expireNotices as any)();

        expect(deleted).toEqual(['n1']);
    });

    it('does not throw when Firestore fails', async () => {
        // It shares the 03:00 slot with the sweep that expires ride requests.
        db = {
            collection: () => ({
                get: async () => { throw new Error('firestore down'); },
                where: () => ({ get: async () => { throw new Error('firestore down'); } }),
            }),
        };
        await expect((expireNotices as any)()).resolves.toBeNull();
    });

    it('caps how much it removes in one run', async () => {
        makeDb(Array.from({ length: 250 }, (_, i) => ({ id: `n${i}`, data: { showUntil: '2020-01-01' } })));
        await (expireNotices as any)();
        expect(deleted).toHaveLength(200);
    });
});

describe('the agenda sweep shares this slot without being coupled to it', () => {
    /**
     * Two independent jobs run at 03:00 in this one handler. The whole point of
     * the arrangement is that neither can take the other down, and that is only
     * true because the agenda step sits OUTSIDE the notice sweep's try/catch.
     */
    it('clears a past sabha agenda, deleting the field and not the document', async () => {
        makeDb([], [{ id: '2026-08-14', data: { agenda: 'Old kirtan' } }]);

        await (expireNotices as any)();

        expect(agendaUpdates).toEqual([{ id: '2026-08-14', data: { agenda: AGENDA_DELETED } }]);
    });

    it('still clears agendas when the notice sweep blows up', async () => {
        // The regression this guards: moving the agenda call inside the notice
        // try block, where a notices failure would skip it for ever.
        makeDb([], [{ id: '2026-08-14', data: { agenda: 'Old kirtan' } }]);
        const noticesGet = db.collection;
        db.collection = (name: string) => {
            if (name === 'notices') {
                return { get: async () => { throw new Error('notices down'); } };
            }
            return noticesGet(name);
        };

        await expect((expireNotices as any)()).resolves.toBeNull();
        expect(agendaUpdates.map(u => u.id)).toEqual(['2026-08-14']);
    });

    it('still takes notices down when the agenda sweep blows up', async () => {
        makeDb([{ id: 'n1', data: { showUntil: '2020-01-01' } }]);
        const inner = db.collection;
        db.collection = (name: string) => {
            if (name === 'events') {
                return { where: () => ({ get: async () => { throw new Error('events down'); } }) };
            }
            return inner(name);
        };

        await expect((expireNotices as any)()).resolves.toBeNull();
        expect(deleted).toEqual(['n1']);
    });

    it('leaves an agenda alone on the day of its own sabha', async () => {
        // Uses the real clock, so build the key the same way the handler does.
        const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        makeDb([], [{ id: todayKey, data: { agenda: 'Tonight' } }]);

        await (expireNotices as any)();

        expect(agendaUpdates).toEqual([]);
    });
});
