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
import { render, screen, act, within, fireEvent } from '@testing-library/react';
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

/**
 * Labelled destinations in the dock, in order.
 *
 * The pull handle is a button too and carries no text, so it is filtered out —
 * and `the dock holds exactly four destinations and the handle` below counts the
 * raw buttons, so this filter cannot hide one that lost its label.
 */
const dockLabels = () =>
    within(dock()).getAllByRole('button')
        .map(b => (b.textContent ?? '').trim())
        .filter(Boolean);

/** The pull handle's bar — a hint, not a control. See GrabHandle in Layout.tsx. */
const handleBar = (panel: HTMLElement) => panel.querySelector('span.rounded-full') as HTMLElement | null;

const swipe = (element: HTMLElement, from: number, to: number) => act(() => {
    fireEvent.touchStart(element, { touches: [{ clientY: from }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientY: to }] });
});

/** The only way to open it. */
const openDrawer = () => swipe(dock(), 800, 730);

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
    it('shows four destinations, not seven', () => {
        renderLayout('manager');

        expect(dockLabels()).toEqual(['Dispatch', 'People', 'Fleet', 'Setup']);
    });

    it('holds four buttons and nothing else — no unlabelled control hiding', () => {
        // Counts raw buttons, so a destination that lost its label would show up
        // here rather than being quietly dropped by the filter above. Four, not
        // five: the handle is a hint, not a button.
        renderLayout('manager');

        expect(within(dock()).getAllByRole('button')).toHaveLength(4);
        expect(handleBar(dock())).not.toBeNull();
    });

    it('offers NO button for the overflow — the gesture is the only way in', () => {
        // Deliberate, decided by the owner on 2026-08-18 with the cost stated:
        // on a phone this dock is the only navigation, so a swipe is now the
        // only route to Reports, Profile and Records. Asserted rather than left
        // implicit so it reads as a decision and not as something that fell off.
        renderLayout('manager');

        expect(within(dock()).queryByRole('button', { name: /more destinations/i })).toBeNull();
        expect(within(dock()).queryByText(/^More$/)).toBeNull();
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

        openDrawer();

        expect(drawer()).not.toBeNull();
        for (const label of ['Reports', 'Profile', 'Records']) {
            expect(within(drawer()!).getByText(label)).toBeInTheDocument();
        }
    });

    it('closes once a destination is chosen', () => {
        renderLayout('manager');
        openDrawer();

        act(() => { within(drawer()!).getByText('Records').click(); });

        expect(drawer()).toBeNull();
    });

    it('closes on Escape', () => {
        renderLayout('manager');
        openDrawer();

        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });

        expect(drawer()).toBeNull();
    });

    it('closes when the click-catcher behind it is tapped', () => {
        renderLayout('manager');
        openDrawer();

        act(() => { scrim()!.click(); });

        expect(drawer()).toBeNull();
    });
});

describe('the dock never reads as "nothing selected"', () => {
    it('turns the handle saffron while a hidden destination is current', () => {
        // Records lives in the drawer. With the More tab gone the handle is the
        // ONLY thing that can say so — without it the manager looks down at a
        // dock with nothing lit and cannot tell where they are.
        renderLayout('manager', 'records');

        act(() => { screen.getByText('goto-records').click(); });

        expect(handleBar(dock())!.className).toMatch(/bg-saffron/);
    });

    it('leaves the handle plain while a docked destination is current', () => {
        renderLayout('manager', 'fleet');

        act(() => { screen.getByText('goto-fleet').click(); });

        expect(handleBar(dock())!.className).not.toMatch(/bg-saffron/);
    });
});

describe('roles with nothing to overflow', () => {
    it('a driver gets no More control at all', () => {
        // FOUR destinations since Airport Seva — 'Arrivals' joined the sabha list on
        // 2026-08-25, and then straight back OUT of it later the same day: the board
        // moved to Airport Seva, which a Sarthi can now switch to. So this list went
        // 3 -> 4 -> 3 in one day and the middle state never reached production.
        //
        // The assertion that carries this test is unchanged and is not the list: it fits
        // the five-slot dock, so there is nothing behind a swipe. A fifth entry would
        // push one destination into the drawer, which opens on a swipe and nothing else
        // — unreachable by keyboard, switch access or VoiceOver. That is the line this
        // guards, and there is now more room under it than before.
        renderLayout('driver');

        expect(dockLabels()).toEqual(['Dashboard', 'History', 'Profile']);
        expect(within(dock()).getAllByRole('button')).toHaveLength(3);
        // Not even the hint: there is nothing a swipe could reveal.
        expect(handleBar(dock())).toBeNull();
    });

    it('a rider gets no More control either', () => {
        renderLayout('student');

        expect(dockLabels()).toEqual(['Home', 'My Rides', 'Profile']);
        expect(within(dock()).queryByRole('button', { name: /more destinations/i })).toBeNull();
    });
});

describe('swipe to open and close', () => {
    /**
     * An ADDITION to the More button, never a replacement — a gesture with no
     * visible control is undiscoverable and unreachable by keyboard.
     *
     * The case that needs a test is the third one: a swipe that STARTS on a nav
     * button still fires that button's click when the finger lifts, so without
     * the capture-phase guard, swiping up from Fleet would open the drawer AND
     * navigate to Fleet.
     */

    it('opens when the dock is swiped up', () => {
        renderLayout('manager');

        swipe(dock(), 800, 740);

        expect(drawer()).not.toBeNull();
    });

    it('closes when the drawer is swiped down', () => {
        renderLayout('manager');
        openDrawer();

        swipe(drawer()!, 700, 780);

        expect(drawer()).toBeNull();
    });

    it('ignores the few pixels a tap drifts', () => {
        // Below the threshold. If this opened the drawer, every tap on a
        // destination would open it on the way through.
        renderLayout('manager');

        swipe(dock(), 800, 790);

        expect(drawer()).toBeNull();
    });

    it('a swipe starting on a destination does not also navigate to it', () => {
        renderLayout('manager', 'home');
        act(() => { screen.getByText('goto-home').click(); });

        const fleet = within(dock()).getByText('Fleet').closest('button')!;
        act(() => {
            fireEvent.touchStart(fleet, { touches: [{ clientY: 800 }] });
            fireEvent.touchEnd(fleet, { changedTouches: [{ clientY: 740 }] });
            fireEvent.click(fleet);
        });

        // Drawer opened, but the tab did NOT change to Fleet.
        expect(drawer()).not.toBeNull();
        expect(within(dock()).getByText('Dispatch').closest('button')!.className).toMatch(/text-saffron-800/);
        expect(fleet.className).not.toMatch(/text-saffron-800/);
    });

    it('a real tap still navigates', () => {
        // The guard must only suppress clicks that followed a swipe.
        renderLayout('manager');

        const fleet = within(dock()).getByText('Fleet').closest('button')!;
        act(() => {
            fireEvent.touchStart(fleet, { touches: [{ clientY: 800 }] });
            fireEvent.touchEnd(fleet, { changedTouches: [{ clientY: 800 }] });
            fleet.click();
        });

        expect(fleet.className).toMatch(/text-saffron-800/);
    });

    it('lets the very next tap through — the swipe that opened it must not eat it', () => {
        // The defect this caught: the "a swipe just happened" flag stayed armed
        // after the opening swipe, so the first tap on a destination inside the
        // drawer was suppressed and the drawer sat there doing nothing. With
        // the gesture as the ONLY way in, every use of the drawer starts with a
        // swipe, so this was on the path every single time.
        renderLayout('manager');
        openDrawer();

        act(() => { within(drawer()!).getByText('Reports').click(); });

        expect(drawer()).toBeNull();
        expect(within(dock()).getByText('Dispatch').closest('button')!.className).not.toMatch(/text-saffron-800/);
    });

    it('does nothing on a dock with nothing to overflow', () => {
        // A driver has three destinations. Swiping must not conjure a drawer.
        renderLayout('driver');

        swipe(dock(), 800, 720);

        expect(drawer()).toBeNull();
    });
});

describe('the drawer and the dock read as one panel', () => {
    it('the dock gives up its top edge while the drawer is open', () => {
        // Its rounded corners cut two notches of drawer colour into the join,
        // and its cast shadow drew a line across it. That was the seam.
        renderLayout('manager');
        expect(dock().className).not.toMatch(/is-expanded/);

        openDrawer();

        expect(dock().className).toMatch(/is-expanded/);
    });

    it('takes its top edge back when the drawer closes', () => {
        renderLayout('manager');
        openDrawer();

        swipe(drawer()!, 700, 780);

        expect(dock().className).not.toMatch(/is-expanded/);
        expect(drawer()).toBeNull();
    });
});
