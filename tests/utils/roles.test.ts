/**
 * The role truth table.
 *
 * Four fields recorded a role and four different queries disagreed about which
 * one counted. The cases below are the ones that were actually wrong somewhere:
 * a role recorded only in `roles[]` (the old getAvailableRoles returned nothing),
 * `activeRole` treated as authority (manualAssignStudent), and the manager →
 * driver implication (which the dispatch pool needs and the old isDriver denied).
 *
 * functions/src/utils/roles.test.ts asserts the same table against the server
 * mirror. If the two files drift, one suite goes red.
 */

import { describe, it, expect } from 'vitest';
import {
    recordedRoles, grantedRoles, hasRecordedRole, hasGrantedRole, isApprovedManager,
} from '../../src/roles';

describe('recordedRoles — what the document literally says', () => {
    it('reads each of the three authority fields on its own', () => {
        expect(recordedRoles({ role: 'manager' })).toEqual(['manager']);
        expect(recordedRoles({ registeredRole: 'driver' })).toEqual(['driver']);
        expect(recordedRoles({ roles: ['student'] })).toEqual(['student']);
    });

    it('ignores activeRole entirely', () => {
        // A user cannot persist activeRole — firestore.rules denies it in
        // touchesPrivilegeFields — so it is frozen at signup and says nothing
        // about what anyone may do.
        expect(recordedRoles({ activeRole: 'manager' })).toEqual([]);
        expect(recordedRoles({ role: 'student', activeRole: 'manager' })).toEqual(['student']);
    });

    it('unions the fields and ranks them, without duplicating', () => {
        expect(recordedRoles({
            role: 'manager', registeredRole: 'manager', roles: ['manager'],
        })).toEqual(['manager']);

        expect(recordedRoles({ role: 'driver', roles: ['student', 'manager'] }))
            .toEqual(['manager', 'driver', 'student']);
    });

    it('does not expand the hierarchy', () => {
        // The distinction the whole module exists for.
        expect(recordedRoles({ role: 'manager' })).toEqual(['manager']);
    });

    it('survives junk without throwing', () => {
        expect(recordedRoles(null)).toEqual([]);
        expect(recordedRoles(undefined)).toEqual([]);
        expect(recordedRoles({})).toEqual([]);
        expect(recordedRoles({ role: 'admin' })).toEqual([]);
        expect(recordedRoles({ role: 42 })).toEqual([]);
        // `roles` holding a bare string rather than an array: 'manager'.includes
        // ('manager') is true, so a naive check would have passed this.
        expect(recordedRoles({ roles: 'manager' })).toEqual([]);
        expect(recordedRoles({ roles: ['manager', 'nonsense', null] })).toEqual(['manager']);
    });
});

describe('grantedRoles — what the person may act as', () => {
    it('reproduces the old getAvailableRoles hierarchy exactly', () => {
        // These three lines are the entire previous implementation. Same output,
        // same order — the role switcher renders straight from this.
        expect(grantedRoles({ registeredRole: 'manager' })).toEqual(['manager', 'driver', 'student']);
        expect(grantedRoles({ registeredRole: 'driver' })).toEqual(['driver', 'student']);
        expect(grantedRoles({ registeredRole: 'student' })).toEqual(['student']);
    });

    it('matches the old output for every shape in production', () => {
        // All 8 live users are one of these two, all four fields agreeing.
        expect(grantedRoles({
            role: 'manager', registeredRole: 'manager', roles: ['manager'], activeRole: 'manager',
        })).toEqual(['manager', 'driver', 'student']);

        expect(grantedRoles({
            role: 'student', registeredRole: 'student', roles: ['student'], activeRole: 'student',
        })).toEqual(['student']);
    });

    it('now handles the shape the old code returned nothing for', () => {
        // Old: `registeredRole || role` — both undefined, switch hit default, [].
        // A manager recorded only in roles[] got no role switcher at all.
        expect(grantedRoles({ roles: ['manager'] })).toEqual(['manager', 'driver', 'student']);
    });

    it('expands downward only', () => {
        expect(grantedRoles({ role: 'driver' })).not.toContain('manager');
        expect(grantedRoles({ role: 'student' })).toEqual(['student']);
    });

    it('returns nothing for an unknown or absent role', () => {
        expect(grantedRoles(null)).toEqual([]);
        expect(grantedRoles({})).toEqual([]);
    });
});

describe('hasRecordedRole vs hasGrantedRole — the distinction that matters', () => {
    const manager = { role: 'manager', accountStatus: 'approved' };

    it('a manager is GRANTED driver but does not RECORD it', () => {
        // Authority checks must use the recorded form or every driver becomes a
        // manager; capability checks (can this person drive?) must use granted or
        // the dispatch pool misses every manager who drives — which, in this
        // deployment, is every driver there is.
        expect(hasGrantedRole(manager, 'driver')).toBe(true);
        expect(hasRecordedRole(manager, 'driver')).toBe(false);
    });

    it('a driver is neither granted nor recorded as manager', () => {
        const driver = { role: 'driver', accountStatus: 'approved' };
        expect(hasGrantedRole(driver, 'manager')).toBe(false);
        expect(hasRecordedRole(driver, 'manager')).toBe(false);
    });
});

describe('isApprovedManager', () => {
    it('requires approval and a recorded manager role', () => {
        expect(isApprovedManager({ role: 'manager', accountStatus: 'approved' })).toBe(true);
        expect(isApprovedManager({ roles: ['manager'], accountStatus: 'approved' })).toBe(true);
        expect(isApprovedManager({ role: 'manager', accountStatus: 'pending' })).toBe(false);
        // The live hole this closed: "Reject" writes accountStatus only, leaving
        // role: 'manager' in place.
        expect(isApprovedManager({ role: 'manager', accountStatus: 'rejected' })).toBe(false);
    });

    it('does not accept activeRole, or inherit from driver', () => {
        expect(isApprovedManager({ activeRole: 'manager', accountStatus: 'approved' })).toBe(false);
        expect(isApprovedManager({ role: 'driver', accountStatus: 'approved' })).toBe(false);
    });
});
