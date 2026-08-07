/**
 * The truth table, cell by cell.
 *
 * Five hand-written copies of this check existed and no two agreed. The two that
 * skipped `accountStatus` were the ones that mattered: `Reject` in the manager
 * console writes `accountStatus` and leaves `role: 'manager'` in place, so a
 * revoked manager kept manual assignment and kept the CSV export of every
 * family's name, phone and home address.
 *
 * Every row below is a case one of those five copies got wrong.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-functions', () => {
    class FakeHttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    }
    return { https: { HttpsError: FakeHttpsError } };
});

vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));

import { isApprovedManagerData, assertApprovedManager } from './authz';

const approved = (extra: Record<string, unknown>) => ({ accountStatus: 'approved', ...extra });

describe('isApprovedManagerData — each manager arm alone', () => {
    it('accepts role', () => {
        expect(isApprovedManagerData(approved({ role: 'manager' }))).toBe(true);
    });

    it('accepts registeredRole', () => {
        // adminDeleteUser was the only site checking this one and not roles[].
        expect(isApprovedManagerData(approved({ registeredRole: 'manager' }))).toBe(true);
    });

    it('accepts roles[]', () => {
        // adminDeleteUser omitted this arm, so it disagreed with the rules.
        expect(isApprovedManagerData(approved({ roles: ['manager'] }))).toBe(true);
    });

    it('accepts roles[] alongside another role', () => {
        expect(isApprovedManagerData(approved({ roles: ['driver', 'manager'] }))).toBe(true);
    });
});

describe('isApprovedManagerData — approval is required', () => {
    it('rejects a pending manager', () => {
        expect(isApprovedManagerData({ accountStatus: 'pending', role: 'manager' })).toBe(false);
    });

    it('rejects a REJECTED manager', () => {
        // The live hole. `Reject` only writes accountStatus; role: 'manager'
        // survives, and manualAssignStudent and generateEventCSV never looked at
        // accountStatus at all.
        expect(isApprovedManagerData({ accountStatus: 'rejected', role: 'manager' })).toBe(false);
        expect(isApprovedManagerData({ accountStatus: 'rejected', roles: ['manager'] })).toBe(false);
        expect(isApprovedManagerData({ accountStatus: 'rejected', registeredRole: 'manager' })).toBe(false);
    });

    it('rejects a manager with no accountStatus at all', () => {
        expect(isApprovedManagerData({ role: 'manager' })).toBe(false);
    });
});

describe('isApprovedManagerData — activeRole is not authority', () => {
    it('rejects activeRole alone, even when approved', () => {
        // activeRole answers "which hat is this person wearing", not "what may
        // they do". manualAssignStudent accepting it is why that function was
        // weaker than the rules it claimed to mirror. It is also a field the
        // RoleSwitcher cannot persist, since touchesPrivilegeFields() denies it.
        expect(isApprovedManagerData(approved({ activeRole: 'manager' }))).toBe(false);
    });

    it('ignores activeRole: student on a genuine manager', () => {
        // A manager viewing the app as a student keeps their authority.
        expect(isApprovedManagerData(approved({ role: 'manager', activeRole: 'student' }))).toBe(true);
    });
});

describe('isApprovedManagerData — non-managers and junk', () => {
    it('rejects an approved student and an approved driver', () => {
        expect(isApprovedManagerData(approved({ role: 'student', roles: ['student'] }))).toBe(false);
        expect(isApprovedManagerData(approved({ role: 'driver', roles: ['driver'] }))).toBe(false);
    });

    it('rejects a missing document without throwing', () => {
        // snap.data() is undefined for a uid with no profile.
        expect(isApprovedManagerData(undefined)).toBe(false);
        expect(isApprovedManagerData(null)).toBe(false);
        expect(isApprovedManagerData({})).toBe(false);
    });

    it('rejects a roles field that is not an array', () => {
        // The old spelling was `!user?.roles?.includes('manager')`, which throws
        // on a string — 'manager'.includes('manager') is true, so a roles field
        // holding the plain string would have passed.
        expect(isApprovedManagerData(approved({ roles: 'manager' }))).toBe(false);
    });
});

describe('assertApprovedManager', () => {
    const dbWith = (data: unknown) => ({
        collection: () => ({ doc: () => ({ get: async () => ({ data: () => data }) }) }),
    }) as any;

    it('returns the document so the caller need not read it again', async () => {
        // adminDeleteUser needs the manager's name for its audit row.
        const caller = await assertApprovedManager(
            dbWith(approved({ role: 'manager', name: 'Mira' })), 'uid');

        expect(caller.name).toBe('Mira');
    });

    it('throws permission-denied naming the action', async () => {
        await expect(assertApprovedManager(
            dbWith(approved({ role: 'student' })), 'uid', 'export data'))
            .rejects.toThrow(/Only approved managers can export data/);
    });

    it('throws for a uid with no profile', async () => {
        await expect(assertApprovedManager(dbWith(undefined), 'ghost'))
            .rejects.toThrow(/Only approved managers/);
    });
});
