/**
 * Role changes while the app is open.
 *
 * `RoleSwitcher` called `React.useState` AFTER an early `return null`, so the
 * number of hooks it rendered depended on live data: zero for a rider with one
 * role, one the moment a manager granted them `driver`.
 *
 * BE CLEAR ABOUT WHAT THESE TESTS DO AND DO NOT PROVE.
 *
 * They do NOT fail against the old hook order. That was checked directly: React
 * 19 tolerates 0 hooks -> 1 hook here, throwing nothing and logging nothing. The
 * violation was latent fragility, not a live crash, and the only thing that
 * actually catches it is `react-hooks/rules-of-hooks` in .eslintrc.cjs.
 *
 * What they DO pin is the behaviour around the transition, which nothing covered
 * before: the switcher appears when a second role arrives, disappears when one is
 * revoked, and holds its open/closed state across an unrelated re-render. Those
 * would break if someone "simplified" the guard or dropped the state.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Roles the fake auth context currently reports. Mutated between renders. */
let roles: string[] = ['student'];

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        activeRole: roles[0] ?? null,
        setActiveRole: vi.fn(),
        getAvailableRoles: () => roles,
        userProfile: { name: 'Riya' },
    }),
}));

import { RoleSwitcher } from '../../components/RoleSwitcher';

beforeEach(() => { roles = ['student']; });

describe('RoleSwitcher — a role arriving while the app is open', () => {
    it('renders nothing for a single role', () => {
        const { container } = render(<RoleSwitcher />);
        expect(container.firstChild).toBeNull();
    });

    it('appears when a second role arrives mid-session', () => {
        // A manager grants `driver` to someone whose app is already open.
        const { rerender, container } = render(<RoleSwitcher />);
        expect(container.firstChild).toBeNull();

        roles = ['student', 'driver'];
        expect(() => act(() => { rerender(<RoleSwitcher />); })).not.toThrow();

        // And it actually appears, rather than merely not crashing.
        expect(container.querySelector('button')).not.toBeNull();
    });

    it('survives 2 roles -> 1 role, the revocation direction', () => {
        roles = ['manager', 'driver'];
        const { rerender, container } = render(<RoleSwitcher />);
        expect(container.querySelector('button')).not.toBeNull();

        roles = ['manager'];
        expect(() => act(() => { rerender(<RoleSwitcher />); })).not.toThrow();
        expect(container.firstChild).toBeNull();
    });

    it('keeps its open/closed state across an unrelated re-render', () => {
        // Guards against the lazy fix: deleting the state would also silence the
        // lint rule, and would silently break the dropdown.
        roles = ['manager', 'driver', 'student'];
        const { rerender, container } = render(<RoleSwitcher />);

        act(() => { (container.querySelector('button') as HTMLButtonElement).click(); });
        const openCount = container.querySelectorAll('button').length;

        act(() => { rerender(<RoleSwitcher />); });
        expect(container.querySelectorAll('button').length).toBe(openCount);
    });
});
