/**
 * Who gets which service.
 *
 * This replaces `airportService.test.tsx`, which asserted the behaviour that turned out
 * to be the bug: a launcher and a switch for **every** account. A student who has lived
 * here two years got an Airport tab they will never use, and somebody still in India got
 * offered lifts to a sabha they cannot attend.
 *
 * THE ASSERTION THAT MATTERS MOST is the first one: an account with `isArriving` absent
 * renders exactly what it rendered before any of this existed. That is the regression
 * guard for every account that already exists, and absent-means-already-here is the
 * whole migration.
 *
 * The rest are the two directions of the mistake this fixes — a local seeing Airport,
 * and an arriving traveller seeing Sabha — plus the one exception, a manager.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let profile: Record<string, unknown> = {
    name: 'Asha', role: 'manager', roles: ['manager'], accountStatus: 'approved',
};

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        userProfile: profile,
        logout: vi.fn(),
        currentUser: { uid: 'u1' },
        getAvailableRoles: () => ['manager'],
        activeRole: profile.role,
        setActiveRole: vi.fn(),
    }),
}));

import { ResponsiveLayout } from '../../components/Layout';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { useService } from '../../hooks/useService';
import type { UserRole } from '../../types';

const dock = () => document.querySelector('.clay-bottom-nav') as HTMLElement;
const sidebar = () => document.querySelector('aside') as HTMLElement;
const header = () => document.querySelector('header') as HTMLElement;

const dockLabels = () =>
    within(dock()).getAllByRole('button')
        .map(b => (b.textContent ?? '').trim())
        .filter(Boolean);

/** Surfaces the derived service and the current tab for assertions. */
const Probe: React.FC = () => {
    const { currentTab } = useNavigation();
    const { service, canSwitch } = useService();
    return (
        <>
            <span data-testid="service">{service}</span>
            <span data-testid="tab">{currentTab}</span>
            <span data-testid="can-switch">{String(canSwitch)}</span>
        </>
    );
};

const renderShell = (role: UserRole) => render(
    <NavigationProvider>
        <Probe />
        <ResponsiveLayout role={role}>
            <div>page</div>
        </ResponsiveLayout>
    </NavigationProvider>,
);

const LOCAL_STUDENT = { name: 'Ramesh', role: 'student', roles: ['student'], accountStatus: 'approved' };
const SARTHI = { name: 'Kiran', role: 'driver', roles: ['driver', 'student'], accountStatus: 'approved' };
const MANAGER = { name: 'Mira', role: 'manager', registeredRole: 'manager', roles: ['manager'], accountStatus: 'approved' };

beforeEach(() => {
    window.localStorage.clear();
    profile = { ...MANAGER };
});

describe('an account that predates all of this', () => {
    it('renders exactly what it rendered before — the migration guard', () => {
        // `isArriving` absent. Every account that exists today is in this state, and it
        // must be indistinguishable from the app before Airport Seva shipped.
        profile = { ...MANAGER };
        renderShell('manager');

        expect(screen.getByTestId('service')).toHaveTextContent('sabha');
        expect(screen.getByTestId('tab')).toHaveTextContent('home');
    });

    it('is not treated as arriving by a falsy-but-present value either', () => {
        profile = { ...LOCAL_STUDENT, isArriving: false };
        renderShell('student');
        expect(screen.getByTestId('service')).toHaveTextContent('sabha');
    });
});

describe('somebody who has not arrived yet', () => {
    beforeEach(() => { profile = { ...LOCAL_STUDENT, isArriving: true }; });

    it('lands in Airport Seva without being asked', () => {
        // No launcher. The whole point: they are in India, and a screen asking which
        // service they want is a screen offering them one they cannot use.
        renderShell('student');
        expect(screen.getByTestId('service')).toHaveTextContent('airport');
        expect(screen.getByTestId('tab')).toHaveTextContent('airport-request');
    });

    it('has no Sabha destination at all', () => {
        renderShell('student');
        const labels = dockLabels().join(' ');
        expect(labels).toContain('My pickup');
        expect(labels).not.toContain('Home');
        expect(labels).not.toContain('My Rides');
    });

    it('gets no arrivals board, even if their role would allow one', () => {
        // A Sarthi flying in is still a traveller. The board is a sabha destination, and
        // they are not in sabha.
        profile = { ...SARTHI, isArriving: true };
        renderShell('driver');
        expect(dockLabels().join(' ')).not.toContain('Arrivals');
    });

    it('gets no switch', () => {
        renderShell('student');
        expect(screen.getByTestId('can-switch')).toHaveTextContent('false');
        expect(within(header()).queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument();
    });
});

describe('a local student', () => {
    beforeEach(() => { profile = { ...LOCAL_STUDENT }; });

    it('gets the app they had, and no Airport destination', () => {
        renderShell('student');
        expect(dockLabels()).toEqual(['Home', 'My Rides', 'Profile']);
    });

    it('gets no switch', () => {
        renderShell('student');
        expect(within(header()).queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument();
    });
});

describe('a Sarthi', () => {
    beforeEach(() => { profile = { ...SARTHI }; });

    it('gets the arrivals board as a TAB, not a service', () => {
        renderShell('driver');
        expect(dockLabels()).toEqual(['Dashboard', 'Arrivals', 'History', 'Profile']);
        expect(screen.getByTestId('service')).toHaveTextContent('sabha');
    });

    it('stays inside the five-slot dock, so no swipe-only drawer appears', () => {
        // Four destinations. A fifth would push one behind a swipe, which is reachable
        // by neither keyboard nor VoiceOver.
        renderShell('driver');
        expect(dockLabels()).toHaveLength(4);
        expect(document.querySelector('.clay-bottom-drawer')).toBeNull();
    });

    it('gets NO switch — this is the whole fix', () => {
        renderShell('driver');
        expect(screen.getByTestId('can-switch')).toHaveTextContent('false');
        expect(within(header()).queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument();
        expect(within(sidebar()).queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument();
    });
});

describe('a manager, the one exception', () => {
    beforeEach(() => { profile = { ...MANAGER }; });

    it('opens on Dispatch, not on a launcher', () => {
        renderShell('manager');
        expect(screen.getByTestId('service')).toHaveTextContent('sabha');
        expect(dockLabels()).toEqual(['Dispatch', 'People', 'Fleet', 'Setup']);
    });

    it('has NO Arrivals tab in Sabha Seva — it lives in their Airport Seva now', () => {
        // It used to be the ninth sabha destination, in the swipe-up drawer. It moved
        // because a manager is the one role holding both services, so the airport
        // service is where their airport work belongs — and because what their Airport
        // Seva held before was the traveller's own request form, which for a manager is
        // a screen built for somebody else.
        renderShell('manager');
        expect(dockLabels()).not.toContain('Arrivals');
        expect(within(sidebar()).queryByRole('button', { name: /arrivals/i }))
            .not.toBeInTheDocument();
    });

    it('keeps a switch, in the header AND the sidebar', () => {
        // Never only in the dock's overflow drawer: that opens on a swipe and nothing
        // else, so a keyboard-only manager would have no door out of Airport Seva.
        renderShell('manager');
        expect(within(header()).getByRole('button', { name: /switch to airport seva/i })).toBeInTheDocument();
        expect(within(sidebar()).getByRole('button', { name: /switch to airport seva/i })).toBeInTheDocument();
    });

    it('actually moves, and lands on the BOARD rather than a traveller form', async () => {
        renderShell('manager');
        await userEvent.click(
            within(header()).getByRole('button', { name: /switch to airport seva/i }));

        expect(screen.getByTestId('service')).toHaveTextContent('airport');
        // The reset is what stops a sabha `switch (currentTab)` being handed an airport
        // value, and what keeps an item lit in the dock. It sends a MANAGER to
        // 'arrivals', not 'airport-request' — the whole point of the 2026-08-25 change.
        expect(screen.getByTestId('tab')).toHaveTextContent('arrivals');
        expect(dockLabels()).toEqual(['Arrivals', 'Profile']);
    });

    it('is never offered the newcomer form, which would file their own pickup', () => {
        // The two defects this replaced. A manager's Airport Seva used to be
        // `TravellerView`: a live form that would file a real request in their name, and
        // an "I am in the USA now" button that wrote `isArriving: false` where it was
        // already false, so it did nothing at all.
        renderShell('manager');
        expect(dockLabels()).not.toContain('My pickup');
    });

    it('and comes back', async () => {
        renderShell('manager');
        await userEvent.click(within(header()).getByRole('button', { name: /switch to airport seva/i }));
        await userEvent.click(within(header()).getByRole('button', { name: /switch to sabha seva/i }));

        expect(screen.getByTestId('service')).toHaveTextContent('sabha');
        expect(screen.getByTestId('tab')).toHaveTextContent('home');
    });

    it('is refused the switch while unapproved', () => {
        profile = { ...MANAGER, accountStatus: 'pending' };
        renderShell('manager');
        expect(screen.getByTestId('can-switch')).toHaveTextContent('false');
    });

    it('is not a manager by the granted set alone', () => {
        // `hasRecordedRole`, not `hasGrantedRole`. Reading the granted set would hand the
        // switch to every Sarthi, which is the same asymmetry isApprovedManagerData
        // carries on the server.
        profile = { name: 'Kiran', role: 'driver', roles: ['driver', 'student'], accountStatus: 'approved' };
        renderShell('driver');
        expect(screen.getByTestId('can-switch')).toHaveTextContent('false');
    });
});

describe('nothing is remembered between sessions', () => {
    it('writes no service to localStorage', () => {
        // The remembered choice went with the launcher. Service is derived, so there is
        // nothing to persist — and a stale key cannot strand somebody in the wrong app.
        renderShell('manager');
        expect(window.localStorage.getItem('active_service')).toBeNull();
    });

    it('ignores a stale key left by the old build', async () => {
        // Anyone who used the deployed version has one of these.
        window.localStorage.setItem('active_service', 'airport');
        profile = { ...LOCAL_STUDENT };
        renderShell('student');

        expect(screen.getByTestId('service')).toHaveTextContent('sabha');
    });
});
