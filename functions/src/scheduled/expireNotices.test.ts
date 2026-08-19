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
vi.mock('firebase-admin', () => ({ firestore: () => db }));

const deleteImage = vi.fn(async (..._a: any[]) => true);
vi.mock('../utils/noticeStorage', () => ({
    deleteNoticeImage: (...a: any[]) => deleteImage(...(a as [])),
}));

import { expireNotices, noticeIsPast } from './expireNotices';

function makeDb(notices: Array<{ id: string; data: any }>) {
    deleted = [];
    db = {
        collection: () => ({
            get: async () => ({
                docs: notices.map(n => ({
                    id: n.id,
                    data: () => n.data,
                    ref: { delete: async () => { deleted.push(n.id); } },
                })),
            }),
        }),
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
        db = { collection: () => ({ get: async () => { throw new Error('firestore down'); } }) };
        await expect((expireNotices as any)()).resolves.toBeNull();
    });

    it('caps how much it removes in one run', async () => {
        makeDb(Array.from({ length: 250 }, (_, i) => ({ id: `n${i}`, data: { showUntil: '2020-01-01' } })));
        await (expireNotices as any)();
        expect(deleted).toHaveLength(200);
    });
});
