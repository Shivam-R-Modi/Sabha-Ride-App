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
    resolveActiveRole, roleFieldsFor, statesRoleConsistently,
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

describe('resolveActiveRole — keep a deliberate switch, drop a revoked one', () => {
    /**
     * AuthContext seeded activeRole once and never looked again. That preserved
     * role-switching state, which was the intent — and left the hat on after a
     * demotion: the manager dashboard and its seven-item nav kept rendering while
     * every read underneath failed, and RoleSwitcher hides itself at one available
     * role, so there was no control to escape with.
     */
    const manager = { role: 'manager' as const, accountStatus: 'approved' };
    const driver = { role: 'driver' as const, accountStatus: 'approved' };
    const student = { role: 'student' as const, accountStatus: 'approved' };

    it('keeps a hat the profile still grants', () => {
        // A manager who switched to Bhulku stays there across an unrelated update.
        expect(resolveActiveRole('student', manager)).toBe('student');
        expect(resolveActiveRole('driver', manager)).toBe('driver');
        expect(resolveActiveRole('student', driver)).toBe('student');
    });

    it('drops a hat that has been revoked, falling back to the recorded role', () => {
        // The demotion case. manager → student: 'manager' is no longer granted.
        expect(resolveActiveRole('manager', student)).toBe('student');
        expect(resolveActiveRole('manager', driver)).toBe('driver');
        expect(resolveActiveRole('driver', student)).toBe('student');
    });

    it('keeps a manager a manager', () => {
        expect(resolveActiveRole('manager', manager)).toBe('manager');
    });

    it('seeds from the recorded role when there is no previous hat', () => {
        expect(resolveActiveRole(null, manager)).toBe('manager');
        expect(resolveActiveRole(null, student)).toBe('student');
    });

    it('returns null rather than guessing when the profile has no usable role', () => {
        // App.tsx falls back to `userProfile.role`; a made-up value here would render
        // a dashboard the person is not entitled to.
        expect(resolveActiveRole('manager', {})).toBeNull();
        expect(resolveActiveRole('manager', null)).toBeNull();
        expect(resolveActiveRole('manager', { role: 'admin' })).toBeNull();
        expect(resolveActiveRole(null, undefined)).toBeNull();
    });

    it('honours a role recorded only in roles[]', () => {
        // The shape the old getAvailableRoles missed entirely.
        expect(resolveActiveRole('student', { roles: ['manager'] })).toBe('student');
    });

    it('does not let activeRole on the document keep a revoked hat alive', () => {
        // `activeRole` is a UI hat, never authority — and the document's copy is
        // frozen at signup because firestore.rules makes it unwritable.
        expect(resolveActiveRole('manager', { role: 'student', activeRole: 'manager' }))
            .toBe('student');
    });
});

/**
 * The predicate that tells a healthy record from a half-written one.
 *
 * `recordedRoles` reads the three fields as a UNION, which is right for "what may
 * this person do" and useless for "is this document coherent" — a healthy Sarthi
 * and a record the raw editor half-changed produce the SAME recorded set. Only a
 * field-by-field comparison separates them, and both the callable and the manager's
 * detail dialog need that answer.
 */
describe('roleFieldsFor — all four fields, from one role', () => {
    it('writes the granted set into roles, not the single role', () => {
        // ['driver'] would drop a Sarthi out of `roles array-contains 'driver'`,
        // which is the query the driver picker runs.
        expect(roleFieldsFor('driver')).toEqual({
            role: 'driver',
            registeredRole: 'driver',
            roles: ['driver', 'student'],
            activeRole: 'driver',
        });
    });

    it('gives a Bhulku exactly one role', () => {
        expect(roleFieldsFor('student').roles).toEqual(['student']);
    });

    it('expands a manager all the way down', () => {
        expect(roleFieldsFor('manager').roles).toEqual(['manager', 'driver', 'student']);
    });
});

describe('statesRoleConsistently', () => {
    const HEALTHY_SARTHI = {
        role: 'driver', registeredRole: 'driver',
        roles: ['driver', 'student'], activeRole: 'driver',
    };

    it('accepts a healthy Sarthi, whose TWO recorded roles are correct', () => {
        // The bug this replaced: `recordedRoles(...).length > 1` called every
        // Sarthi in the congregation broken, because driver implies student.
        expect(statesRoleConsistently(HEALTHY_SARTHI, 'driver')).toBe(true);
    });

    it('accepts a healthy Bhulku and a healthy manager', () => {
        expect(statesRoleConsistently({
            role: 'student', registeredRole: 'student',
            roles: ['student'], activeRole: 'student',
        }, 'student')).toBe(true);

        expect(statesRoleConsistently({
            role: 'manager', registeredRole: 'manager',
            roles: ['manager', 'driver', 'student'], activeRole: 'manager',
        }, 'manager')).toBe(true);
    });

    it('rejects the half-write the raw field editor could always produce', () => {
        // `role` says driver, everything else still says student. hasRecordedRole
        // reports 'driver' here AND on the healthy record above, so it cannot be
        // the test.
        expect(statesRoleConsistently({
            role: 'driver', registeredRole: 'student',
            roles: ['student'], activeRole: 'student',
        }, 'driver')).toBe(false);
    });

    it('rejects a record whose roles[] was never widened', () => {
        expect(statesRoleConsistently({
            role: 'driver', registeredRole: 'driver',
            roles: ['driver'], activeRole: 'driver',
        }, 'driver')).toBe(false);
    });

    it('rejects a stale activeRole left behind by a demotion', () => {
        expect(statesRoleConsistently({
            role: 'student', registeredRole: 'student',
            roles: ['student'], activeRole: 'driver',
        }, 'student')).toBe(false);
    });

    it('ignores the order of roles[]', () => {
        expect(statesRoleConsistently(
            { ...HEALTHY_SARTHI, roles: ['student', 'driver'] }, 'driver',
        )).toBe(true);
    });

    it('rejects a roles[] carrying something extra', () => {
        // A Bhulku with 'driver' still in the array is exactly the state a
        // demotion must not leave behind.
        expect(statesRoleConsistently({
            role: 'student', registeredRole: 'student',
            roles: ['student', 'driver'], activeRole: 'student',
        }, 'student')).toBe(false);
    });

    it('is false for no document at all', () => {
        expect(statesRoleConsistently(null, 'student')).toBe(false);
        expect(statesRoleConsistently(undefined, 'driver')).toBe(false);
    });
});
