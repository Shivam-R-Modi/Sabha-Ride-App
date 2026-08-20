/**
 * Cutting an account off leaves a record.
 *
 * `manager.promote` audited a GRANT and nothing audited the other direction, so a
 * revocation left no trace of who did it or when — on a system holding children's
 * names, phone numbers and home addresses, where
 * docs/compliance/ownership-and-handover.md requires "every grant, revocation and
 * impersonation audited".
 *
 * The load-bearing assertions here are the ORDER (the row is written after the
 * update, so a refused write cannot leave a row claiming it happened) and the ACTOR
 * (a row that cannot name who acted looks like a record and identifies nobody).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const order: string[] = [];
const updates: Array<{ path: string; data: any }> = [];
const auditRows: any[] = [];

let updateShouldThrow = false;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    updateDoc: async (ref: any, data: any) => {
        order.push('update');
        if (updateShouldThrow) throw new Error('Missing or insufficient permissions.');
        updates.push({ path: ref.path, data });
    },
    // Present because the module imports them; unused on this path.
    collection: () => ({}),
    setDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: () => () => undefined,
    query: () => ({}),
    where: () => ({}),
    orderBy: () => ({}),
    limit: () => ({}),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
    startAfter: () => ({}),
}));

vi.mock('../../src/utils/audit', () => ({
    writeAuditLog: async (entry: any) => { order.push('audit'); auditRows.push(entry); },
}));

import { updateUserStatus } from '../../hooks/useUsers';

const ACTOR = { uid: 'mgr_1', name: 'Mira' };

beforeEach(() => {
    order.length = 0;
    updates.length = 0;
    auditRows.length = 0;
    updateShouldThrow = false;
});

describe('updateUserStatus — approving', () => {
    it('writes the status and nothing else', async () => {
        await updateUserStatus('drv1', 'approved', ACTOR);

        expect(updates).toEqual([{ path: 'users/drv1', data: { accountStatus: 'approved' } }]);
    });

    it('records who approved whom', async () => {
        await updateUserStatus('drv1', 'approved', ACTOR);

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: 'account.approved',
            actorUid: 'mgr_1',
            actorName: 'Mira',
            targetCollection: 'users',
            targetDocumentId: 'drv1',
        });
    });
});

describe('updateUserStatus — rejecting', () => {
    it('records the revocation, which nothing used to', async () => {
        await updateUserStatus('drv1', 'rejected', ACTOR);

        expect(auditRows[0]).toMatchObject({
            action: 'account.rejected',
            actorUid: 'mgr_1',
            targetDocumentId: 'drv1',
        });
    });

    it('says in the summary that access was cut off', async () => {
        // The row is read by a human later; 'rejected' alone does not say what it did.
        await updateUserStatus('drv1', 'rejected', ACTOR);
        expect(auditRows[0].summary).toMatch(/cutting off access/i);
    });
});

describe('the row cannot outlive a failed write', () => {
    it('writes the update BEFORE the audit row', async () => {
        await updateUserStatus('drv1', 'rejected', ACTOR);
        expect(order).toEqual(['update', 'audit']);
    });

    it('records nothing when the write is refused', async () => {
        // A row claiming a revocation that never happened is worse than no row: it
        // would read as proof that access had been removed.
        updateShouldThrow = true;

        await expect(updateUserStatus('drv1', 'rejected', ACTOR)).rejects.toThrow(/permissions/);

        expect(auditRows).toEqual([]);
        expect(order).toEqual(['update']);
    });
});
