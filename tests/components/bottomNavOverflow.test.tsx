/**
 * The mobile dock's overflow drawer.
 *
 * A manager had seven destinations across a 390px phone — ~47px each, under a
 * comfortable thumb target. Four stay docked (Dispatch, People, Fleet, Setup)
 * and the rest move behind a More control.
 *
 * Two assertions here would catch a real regression rather than a cosmetic one:
 *
 *   - drivers and riders must get NO More control. They have three destinations
 *     and nothing to overflow, and a button that opens an empty drawer is the
 *     dead control this repo keeps deleting.
 *   - when the current tab is one of the HIDDEN ones, the dock must still show
 *     something selected. Otherwise a manager sitting on Records looks down at a
 *     dock with nothing lit and has lost their place.
 *
 * The SIDEBAR is deliberately unaffected — a desktop rail has room for all seven
 * — so that is asserted too. Both are rendered in jsdom, which applies no CSS,
 * so every query below is scoped to one or the other.
 */

import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        userProfile: { name: 'Asha' },
        logout: vi.fn(),
        currentUser: { uid: 'manager_1' },
        getAvailableRoles: () => ['manager'],
        activeRole: 'manager',
        setActiveRole: vi.fn(),
    }),
}));

import { ResponsiveLayout } from '../../components/Layout';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import type { TabView, UserRole } from '../../types';

const dock = () => document.querySelector('.clay-bottom-nav') as HTMLElement;
const drawer = () => document.querySelector('.clay-bottom-drawer') as HTMLElement | null;
const sidebar = () => document.querySelector('aside') as HTMLElement;
const scrim = () => document.querySelector('.fixed.inset-0') as HTMLElement | null;

/** Visible button labels in the dock, in order. */
const dockLabels = () =>
    within(dock()).getAllByRole('button').map(b => (b.textContent ?? '').trim());

const moreButton = () => within(dock()).getByRole('button', { name: /more destinations/i });

/** Lets a test put the app on a given tab from inside the provider. */
const Goto: React.FC<{ tab: TabView }> = ({ tab }) => {
    const { setCurrentTab } = useNavigation();
    return <button onClick={() => setCurrentTab(tab)}>goto-{tab}</button>;
};

const renderLayout = (role: UserRole, tab?: TabView) => render(
    <NavigationProvider>
        {tab && <Goto tab={tab} />}
        <ResponsiveLayout role={role}>
            <div>page</div>
        </ResponsiveLayout>
    </NavigationProvider>
);

beforeEach(() => {
    window.localStorage.clear();
});

describe('the manager dock', () => {
    it('shows four destinations and a More control, not seven', () => {
        renderLayout('manager');

        expect(dockLabels()).toEqual(['Dispatch', 'People', 'Fleet', 'Setup', 'More']);
    });

    it('leaves the overflow destinations OUT of the dock entirely', () => {
        // Absent, not merely hidden: a hidden-but-present button is still a tap
        // target for a screen reader and still competes for the 390px.
        renderLayout('manager');

        for (const label of ['Reports', 'Profile', 'Records']) {
            expect(within(dock()).queryByText(label)).toBeNull();
        }
    });

    it('keeps all seven in the sidebar, where there is room', () => {
        renderLayout('manager');

        for (const label of ['Dispatch', 'People', 'Reports', 'Fleet', 'Setup', 'Profile', 'Records']) {
            expect(within(sidebar()).getByText(label)).toBeInTheDocument();
        }
    });

    it('opens the drawer with the remaining three', () => {
        renderLayout('manager');
        expect(drawer()).toBeNull();

        act(() => { moreButton().click(); });

        expect(drawer()).not.toBeNull();
        for (const label of ['Reports', 'Profile', 'Records']) {
            expect(within(drawer()!).getByText(label)).toBeInTheDocument();
        }
    });

    it('closes once a destination is chosen', () => {
        renderLayout('manager');
        act(() => { moreButton().click(); });

        act(() => { within(drawer()!).getByText('Records').click(); });

        expect(drawer()).toBeNull();
    });

    it('closes on Escape', () => {
        renderLayout('manager');
        act(() => { moreButton().click(); });

        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });

        expect(drawer()).toBeNull();
    });

    it('closes when the click-catcher behind it is tapped', () => {
        renderLayout('manager');
        act(() => { moreButton().click(); });

        act(() => { scrim()!.click(); });

        expect(drawer()).toBeNull();
    });
});

describe('the dock never reads as "nothing selected"', () => {
    it('marks More as active while a hidden destination is current', () => {
        // Records lives in the drawer. Without this the manager looks down at a
        // dock with no lit item and cannot tell where they are.
        renderLayout('manager', 'records');

        act(() => { screen.getByText('goto-records').click(); });

        expect(moreButton().className).toMatch(/text-saffron-800/);
    });

    it('does not mark More while a docked destination is current', () => {
        renderLayout('manager', 'fleet');

        act(() => { screen.getByText('goto-fleet').click(); });

        expect(moreButton().className).not.toMatch(/text-saffron-800/);
    });
});

describe('roles with nothing to overflow', () => {
    it('a driver gets no More control at all', () => {
        // Three destinations. A More button here would open an empty drawer.
        renderLayout('driver');

        expect(dockLabels()).toEqual(['Dashboard', 'History', 'Profile']);
        expect(within(dock()).queryByRole('button', { name: /more destinations/i })).toBeNull();
    });

    it('a rider gets no More control either', () => {
        renderLayout('student');

        expect(dockLabels()).toEqual(['Home', 'My Rides', 'Profile']);
        expect(within(dock()).queryByRole('button', { name: /more destinations/i })).toBeNull();
    });
});
