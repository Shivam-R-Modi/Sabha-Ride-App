/**
 * The same truth table as tests/utils/roles.test.ts, asserted against the server
 * mirror. The two modules cannot import each other — separate tsconfigs, no
 * shared path — so the tables are kept honest by both suites asserting the same
 * cases. If one file drifts, one suite goes red.
 */

import { describe, it, expect } from 'vitest';
import {
    recordedRoles, grantedRoles, hasRecordedRole, hasGrantedRole,
    roleFieldsFor, statesRoleConsistently,
} from './roles';

describe('recordedRoles (server mirror)', () => {
    it('reads each authority field on its own', () => {
        expect(recordedRoles({ role: 'manager' })).toEqual(['manager']);
        expect(recordedRoles({ registeredRole: 'driver' })).toEqual(['driver']);
        expect(recordedRoles({ roles: ['student'] })).toEqual(['student']);
    });

    it('ignores activeRole', () => {
        expect(recordedRoles({ activeRole: 'manager' })).toEqual([]);
    });

    it('unions and ranks without duplicating', () => {
        expect(recordedRoles({ role: 'driver', roles: ['student', 'manager'] }))
            .toEqual(['manager', 'driver', 'student']);
    });

    it('survives junk', () => {
        expect(recordedRoles(null)).toEqual([]);
        expect(recordedRoles({})).toEqual([]);
        expect(recordedRoles({ roles: 'manager' })).toEqual([]);
        expect(recordedRoles({ role: 'admin' })).toEqual([]);
    });
});

describe('grantedRoles (server mirror)', () => {
    it('expands downward only', () => {
        expect(grantedRoles({ role: 'manager' })).toEqual(['manager', 'driver', 'student']);
        expect(grantedRoles({ role: 'driver' })).toEqual(['driver', 'student']);
        expect(grantedRoles({ role: 'student' })).toEqual(['student']);
        expect(grantedRoles({ role: 'driver' })).not.toContain('manager');
    });

    it('handles the roles[]-only shape', () => {
        expect(grantedRoles({ roles: ['manager'] })).toEqual(['manager', 'driver', 'student']);
    });
});

describe('the distinction the dispatch pool depends on', () => {
    const manager = { role: 'manager', registeredRole: 'manager', roles: ['manager'] };

    it('a manager may drive, but is not recorded as a driver', () => {
        // In this deployment every person who actually drives is a manager, so a
        // pool query built on the recorded form matches nobody.
        expect(hasGrantedRole(manager, 'driver')).toBe(true);
        expect(hasRecordedRole(manager, 'driver')).toBe(false);
    });

    it('a student may not drive', () => {
        expect(hasGrantedRole({ role: 'student', roles: ['student'] }, 'driver')).toBe(false);
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
