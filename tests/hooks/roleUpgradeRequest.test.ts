/**
 * A Bhulku asking to become a Sarthi, and a manager turning it down.
 *
 * The request grants nothing — the role change is refused by firestore.rules
 * whatever this field says — so what these tests guard is narrower and easier to
 * get wrong: that a rider can only ever write `pending`, that a previous
 * rejection cannot survive underneath a new request, and that a decline leaves
 * something on the document for the person to READ. A decline that simply makes
 * the request vanish is how somebody ends up asking three more times.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const updates: Array<{ path: string; data: any }> = [];
const auditRows: any[] = [];
const order: string[] = [];

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    updateDoc: async (ref: any, data: any) => {
        order.push('update');
        updates.push({ path: ref.path, data });
    },
    // Present because the module imports them; unused on these paths.
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

import {
    requestRoleUpgrade, clearRoleUpgradeRequest, declineRoleUpgrade,
} from '../../hooks/useUsers';

const ACTOR = { uid: 'mgr_1', name: 'Mira' };

beforeEach(() => {
    updates.length = 0;
    auditRows.length = 0;
    order.length = 0;
});

describe('requestRoleUpgrade', () => {
    it('writes a pending request against the person who asked', async () => {
        await requestRoleUpgrade('rdr1');

        expect(updates).toHaveLength(1);
        expect(updates[0]!.path).toBe('users/rdr1');
        expect(updates[0]!.data.roleUpgrade).toMatchObject({ status: 'pending' });
        expect(typeof updates[0]!.data.roleUpgrade.requestedAt).toBe('string');
    });

    it('claims no outcome — pending is the only status a rider may write', async () => {
        // firestore.rules holds them to this too. Both halves matter: the rule is
        // the guard, and this is the client not asking to be refused.
        await requestRoleUpgrade('rdr1');
        expect(updates[0]!.data.roleUpgrade.status).toBe('pending');
    });

    it('replaces the whole map, so an old rejection cannot survive under it', async () => {
        // Merging a field would leave `decidedByName` and a stale `decidedAt`
        // behind, and the profile would show "we are looking at this" and "you
        // were turned down" at the same time.
        await requestRoleUpgrade('rdr1');

        expect(Object.keys(updates[0]!.data.roleUpgrade).sort())
            .toEqual(['requestedAt', 'status']);
    });

    it('touches nothing else on the document', async () => {
        await requestRoleUpgrade('rdr1');
        expect(Object.keys(updates[0]!.data)).toEqual(['roleUpgrade']);
    });

    it('never writes a role field — a rider cannot promote themselves', async () => {
        await requestRoleUpgrade('rdr1');

        const written = updates[0]!.data;
        expect(written).not.toHaveProperty('role');
        expect(written).not.toHaveProperty('registeredRole');
        expect(written).not.toHaveProperty('roles');
        expect(written).not.toHaveProperty('activeRole');
        expect(written).not.toHaveProperty('accountStatus');
    });
});

describe('clearRoleUpgradeRequest', () => {
    it('nulls the field, for both withdrawing and dismissing', async () => {
        await clearRoleUpgradeRequest('rdr1');

        expect(updates).toEqual([{ path: 'users/rdr1', data: { roleUpgrade: null } }]);
    });
});

describe('declineRoleUpgrade', () => {
    it('leaves a rejection the person can read, not an empty field', async () => {
        // The whole point. A decline that clears the request tells the rider
        // nothing, so they ask again — and the manager's queue fills with
        // duplicates of a decision already made.
        await declineRoleUpgrade('rdr1', '2026-08-24T09:00:00.000Z', ACTOR);

        expect(updates[0]!.data.roleUpgrade).toMatchObject({
            status: 'rejected',
            requestedAt: '2026-08-24T09:00:00.000Z',
            decidedBy: 'mgr_1',
            decidedByName: 'Mira',
        });
        expect(typeof updates[0]!.data.roleUpgrade.decidedAt).toBe('string');
    });

    it('keeps the original request time, so the wait is still visible', async () => {
        await declineRoleUpgrade('rdr1', '2026-08-20T08:00:00.000Z', ACTOR);
        expect(updates[0]!.data.roleUpgrade.requestedAt).toBe('2026-08-20T08:00:00.000Z');
    });

    it('substitutes a time rather than writing undefined when one is missing', async () => {
        // Firestore rejects an undefined value outright, so a request document
        // written by an older client must not take the decline down with it.
        await declineRoleUpgrade('rdr1', undefined, ACTOR);
        expect(typeof updates[0]!.data.roleUpgrade.requestedAt).toBe('string');
    });

    it('records who declined it', async () => {
        await declineRoleUpgrade('rdr1', '2026-08-24T09:00:00.000Z', ACTOR);

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            actorUid: 'mgr_1',
            actorName: 'Mira',
            targetCollection: 'users',
            targetDocumentId: 'rdr1',
        });
        expect(auditRows[0].summary).toMatch(/Sarthi/);
    });

    it('writes the row AFTER the change, so a refused write leaves no false record', async () => {
        await declineRoleUpgrade('rdr1', '2026-08-24T09:00:00.000Z', ACTOR);
        expect(order).toEqual(['update', 'audit']);
    });

    it('never writes a role field — declining changes nothing about access', async () => {
        await declineRoleUpgrade('rdr1', '2026-08-24T09:00:00.000Z', ACTOR);

        const written = updates[0]!.data;
        expect(Object.keys(written)).toEqual(['roleUpgrade']);
    });
});
