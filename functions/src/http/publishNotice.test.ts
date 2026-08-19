/**
 * Publishing and removing a notice.
 *
 * The two assertions that carry real weight:
 *
 *  - **half an image pair is refused.** A path with no URL cannot be rendered; a
 *    URL with no path cannot be DELETED, which is precisely how Storage fills up
 *    with orphans that nobody can see or account for.
 *  - **the image path must be inside notices/.** Without that check a manager
 *    could point a notice at any object in the bucket and have the delete path
 *    remove it later.
 *
 * Line breaks are KEPT here, unlike managerBroadcast which collapses whitespace —
 * a flyer is a paragraph block and the format depends on them.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let db: any;
let added: any[];
let auditRows: any[];
let order: string[];

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) { super(message); this.name = 'HttpsError'; }
    }
    return { https: { onCall: (h: any) => h, HttpsError: FakeHttpsError } };
});
vi.mock('firebase-admin', () => ({ firestore: () => db }));

const notifyEveryone = vi.fn(async (..._a: any[]) => undefined);
vi.mock('../utils/notifications', () => ({ notifyEveryone: (...a: any[]) => notifyEveryone(...(a as [])) }));

const approvedManager = vi.fn(async () => ({ name: 'Mira' }));
vi.mock('../utils/authz', () => ({ assertApprovedManager: (...a: any[]) => approvedManager(...(a as [])) }));

const rateLimit = vi.fn(async () => undefined);
vi.mock('../utils/rateLimiter', () => ({ checkRateLimit: (...a: any[]) => rateLimit(...(a as [])) }));

vi.mock('../utils/audit', () => ({
    writeAuditLog: async (_db: any, entry: any) => {
        auditRows.push({ ...entry });
        return { set: async (p: any) => { Object.assign(auditRows[auditRows.length - 1], p); } };
    },
}));

const deleteImage = vi.fn(async (..._a: any[]) => true);
vi.mock('../utils/noticeStorage', () => ({ deleteNoticeImage: (...a: any[]) => deleteImage(...(a as [])) }));

import { publishNotice } from './publishNotice';
import { deleteNotice } from './deleteNotice';

let existingNotice: any;

function makeDb() {
    added = []; auditRows = []; order = [];
    db = {
        collection: () => ({
            add: async (doc: any) => { added.push(doc); order.push('write'); return { id: 'n1' }; },
            doc: () => ({
                get: async () => ({ exists: existingNotice !== null, data: () => existingNotice }),
                delete: async () => { order.push('doc-delete'); },
            }),
        }),
    };
}

const publish = (data: any) => (publishNotice as any)(data, { auth: { uid: 'mgr_1' } });

beforeEach(() => {
    vi.clearAllMocks();
    approvedManager.mockResolvedValue({ name: 'Mira' });
    rateLimit.mockResolvedValue(undefined);
    deleteImage.mockResolvedValue(true);
    existingNotice = { imagePath: 'notices/n1/flyer.jpg' };
    notifyEveryone.mockImplementation(async () => { order.push('push'); });
    makeDb();
});

describe('publishNotice — content', () => {
    it('keeps the line breaks a flyer depends on', async () => {
        await publish({ body: 'Line one\n\nLine two' });
        expect(added[0].body).toBe('Line one\n\nLine two');
    });

    it('refuses an empty message', async () => {
        await expect(publish({ body: '   \n ' })).rejects.toThrow(/message is required/i);
    });

    it('caps the length', async () => {
        await expect(publish({ body: 'x'.repeat(4001) })).rejects.toThrow(/under 4000/i);
    });

    it('refuses a non-manager', async () => {
        approvedManager.mockRejectedValue(new Error('Only approved managers can publish a notice.'));
        await expect(publish({ body: 'hi' })).rejects.toThrow(/managers/i);
        expect(added).toHaveLength(0);
    });

    it('validates the date shape', async () => {
        await expect(publish({ body: 'hi', showUntil: '21 Aug' })).rejects.toThrow(/YYYY-MM-DD/);
        await expect(publish({ body: 'hi', showUntil: '2026-08-21' })).resolves.toBeDefined();
    });
});

describe('publishNotice — the image pair', () => {
    it('refuses a URL with no path', async () => {
        // Renderable but undeletable — the shape that fills the bucket.
        await expect(publish({ body: 'hi', imageUrl: 'https://x/y.jpg' }))
            .rejects.toThrow(/both its path and its URL/i);
    });

    it('refuses a path with no URL', async () => {
        await expect(publish({ body: 'hi', imagePath: 'notices/n1/y.jpg' }))
            .rejects.toThrow(/both its path and its URL/i);
    });

    it('refuses a path outside notices/', async () => {
        // Otherwise a notice could be pointed at any object in the bucket, and
        // the delete path would later remove it.
        await expect(publish({ body: 'hi', imagePath: 'users/someone/private.jpg', imageUrl: 'https://x/y' }))
            .rejects.toThrow(/not a notice image/i);
    });

    it('refuses a path that reads like traversal', async () => {
        // Storage names are literal, so this cannot escape — but the path is used
        // to delete an object later and does not belong in that position.
        await expect(publish({ body: 'hi', imagePath: 'notices/../x.jpg', imageUrl: 'https://x/y' }))
            .rejects.toThrow(/not a notice image/i);
    });

    it('accepts a complete pair', async () => {
        await expect(publish({
            body: 'hi', imagePath: 'notices/n1/flyer.jpg', imageUrl: 'https://x/flyer.jpg',
        })).resolves.toEqual({ success: true, noticeId: 'n1' });
        expect(added[0].imagePath).toBe('notices/n1/flyer.jpg');
    });

    it('stores nulls, not undefined, when there is no image', async () => {
        await publish({ body: 'hi' });
        expect(added[0].imagePath).toBeNull();
        expect(added[0].imageUrl).toBeNull();
    });
});

describe('publishNotice — the optional push', () => {
    it('sends nothing unless asked', async () => {
        await publish({ body: 'hi' });
        expect(notifyEveryone).not.toHaveBeenCalled();
    });

    it('pushes AFTER the notice is written', async () => {
        // A push for a notice that failed to save would be a lie.
        await publish({ body: 'hi', push: true });
        expect(order).toEqual(['write', 'push']);
    });

    it('sends an excerpt, not the whole flyer', async () => {
        // A notification is a nudge; the notice is the content.
        await publish({ body: 'x'.repeat(400), push: true });
        const [, body] = notifyEveryone.mock.calls[0] as any[];
        expect(body.length).toBeLessThan(130);
        expect(body.endsWith('…')).toBe(true);
    });
});

describe('deleteNotice', () => {
    const remove = () => (deleteNotice as any)({ noticeId: 'n1' }, { auth: { uid: 'mgr_1' } });

    it('deletes the image before the document', async () => {
        deleteImage.mockImplementation(async () => { order.push('image'); return true; });
        await remove();
        expect(order).toEqual(['image', 'doc-delete']);
    });

    it('is idempotent when the notice is already gone', async () => {
        existingNotice = null;
        await expect(remove()).resolves.toEqual({ success: true, alreadyGone: true });
        expect(deleteImage).not.toHaveBeenCalled();
    });

    it('records in the audit row when the image survived', async () => {
        deleteImage.mockResolvedValue(false);
        await remove();
        expect(auditRows[0].summary).toMatch(/image could not be deleted/i);
    });

    it('refuses a non-manager', async () => {
        approvedManager.mockRejectedValue(new Error('Only approved managers can remove a notice.'));
        await expect(remove()).rejects.toThrow(/managers/i);
        expect(order).toEqual([]);
    });
});
