/**
 * The same truth table as tests/utils/roles.test.ts, asserted against the server
 * mirror. The two modules cannot import each other — separate tsconfigs, no
 * shared path — so the tables are kept honest by both suites asserting the same
 * cases. If one file drifts, one suite goes red.
 */

import { describe, it, expect } from 'vitest';
import { recordedRoles, grantedRoles, hasRecordedRole, hasGrantedRole } from './roles';

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
