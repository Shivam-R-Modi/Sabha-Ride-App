/**
 * Two services behind one login.
 *
 * Airport Seva is not a feature inside the ride app, so the assertions that matter
 * are mostly about SEPARATION and about not being able to get stuck:
 *
 *  - **picking Sabha renders exactly what the app rendered before.** The sabha branch
 *    was not edited to make room for the second service, and this is what says so.
 *  - **the switch is reachable without a swipe.** The mobile dock's overflow drawer
 *    opens on a swipe and nothing else — an owner decision recorded on GrabHandle —
 *    so a switch that lived only in there would make Airport Seva a room with no door
 *    out for anybody using a keyboard, switch access or VoiceOver.
 *  - **switching resets the tab.** The two services share one `TabView` union. Without
 *    the reset, a manager leaving `airport-board` for Sabha would hit a
 *    `switch (currentTab)` with no matching case, and the dock would light nothing.
 *  - **a Bhulku gets no Arrivals tab.** The rules refuse every query that board makes,
 *    so for them it would render an empty screen reading "nobody is arriving".
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
import { ServiceLauncher } from '../../components/airport/ServiceLauncher';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { SERVICE_STORAGE_KEY } from '../../src/constants/service';
import type { Service, TabView, UserRole } from '../../types';

const dock = () => document.querySelector('.clay-bottom-nav') as HTMLElement;
const sidebar = () => document.querySelector('aside') as HTMLElement;
const header = () => document.querySelector('header') as HTMLElement;

const dockLabels = () =>
    within(dock()).getAllByRole('button')
        .map(b => (b.textContent ?? '').trim())
        .filter(Boolean);

/** Lets a test choose a service and a tab from inside the provider. */
const Drive: React.FC<{ service?: Service; canSeeBoard?: boolean; tab?: TabView }> = ({
    service, canSeeBoard = true, tab,
}) => {
    const { setService, setCurrentTab, currentTab } = useNavigation();
    return (
        <>
            {service && (
                <button onClick={() => setService(service, canSeeBoard)}>pick-{service}</button>
            )}
            {tab && <button onClick={() => setCurrentTab(tab)}>goto-{tab}</button>}
            <span data-testid="current-tab">{currentTab}</span>
        </>
    );
};

const renderShell = (role: UserRole, props: React.ComponentProps<typeof Drive> = {}) => render(
    <NavigationProvider>
        <Drive {...props} />
        <ResponsiveLayout role={role}>
            <div>page</div>
        </ResponsiveLayout>
    </NavigationProvider>,
);

beforeEach(() => {
    window.localStorage.clear();
    profile = { name: 'Asha', role: 'manager', roles: ['manager'], accountStatus: 'approved' };
});

describe('the launcher', () => {
    it('offers both services and nothing else', () => {
        render(<NavigationProvider><ServiceLauncher /></NavigationProvider>);

        const list = screen.getByRole('list', { name: /choose a seva/i });
        expect(within(list).getAllByRole('button')).toHaveLength(2);
        expect(within(list).getByText('Sabha Seva')).toBeInTheDocument();
        expect(within(list).getByText('Airport Seva')).toBeInTheDocument();
    });

    it('greets the person by name when we know it', () => {
        render(<NavigationProvider><ServiceLauncher /></NavigationProvider>);
        expect(screen.getByText(/Jai Swaminarayan, Asha/)).toBeInTheDocument();
    });

    it('says the choice is not final', () => {
        // Otherwise it reads as a decision, and somebody picks the wrong one and
        // cannot see how to get back.
        render(<NavigationProvider><ServiceLauncher /></NavigationProvider>);
        expect(screen.getByText(/switch between them at any time/i)).toBeInTheDocument();
    });

    it('names no weekday, because a sabha schedule is a rule and not a constant', () => {
        const { container } = render(<NavigationProvider><ServiceLauncher /></NavigationProvider>);
        expect(container.textContent).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    });
});

describe('Sabha Seva is untouched', () => {
    it('a manager gets the same four docked destinations as before', () => {
        // The regression guard for the whole change: the sabha branch was not edited
        // to make room for a second service.
        renderShell('manager', { service: 'sabha' });
        expect(dockLabels()).toEqual(['Dispatch', 'People', 'Fleet', 'Setup']);
    });

    it('a Sarthi gets the same three as before', () => {
        renderShell('driver', { service: 'sabha' });
        expect(dockLabels()).toEqual(['Dashboard', 'History', 'Profile']);
    });
});

describe('Airport Seva', () => {
    it('gives a Sarthi the board, their own pickup, and their profile', async () => {
        renderShell('driver', { service: 'airport' });
        await userEvent.click(screen.getByText('pick-airport'));

        expect(dockLabels()).toEqual(['Arrivals', 'My pickup', 'Profile']);
    });

    it('gives a Bhulku NO board', async () => {
        // Every query it makes is refused by the rules, so the tab would render an
        // empty screen that reads as "nobody is arriving".
        profile = { name: 'Ramesh', role: 'student', roles: ['student'], accountStatus: 'approved' };
        renderShell('student', { service: 'airport', canSeeBoard: false });
        await userEvent.click(screen.getByText('pick-airport'));

        expect(dockLabels()).toEqual(['My pickup', 'Profile']);
    });

    it('opens a Sarthi on the board and a Bhulku on their own pickup', async () => {
        const sarthi = renderShell('driver', { service: 'airport' });
        await userEvent.click(screen.getByText('pick-airport'));
        expect(screen.getByTestId('current-tab')).toHaveTextContent('airport-board');
        sarthi.unmount();

        window.localStorage.clear();
        renderShell('student', { service: 'airport', canSeeBoard: false });
        await userEvent.click(screen.getByText('pick-airport'));
        expect(screen.getByTestId('current-tab')).toHaveTextContent('airport-request');
    });
});

describe('you can always get back out', () => {
    it('the switch is in the mobile header, not behind a swipe', async () => {
        renderShell('manager', { service: 'airport' });
        await userEvent.click(screen.getByText('pick-airport'));

        expect(within(header()).getByRole('button', { name: /switch to sabha seva/i }))
            .toBeInTheDocument();
    });

    it('the switch is in the sidebar too', async () => {
        renderShell('manager', { service: 'airport' });
        await userEvent.click(screen.getByText('pick-airport'));

        expect(within(sidebar()).getByRole('button', { name: /switch to sabha seva/i }))
            .toBeInTheDocument();
    });

    it('it points at the other service, whichever one you are in', async () => {
        renderShell('manager', { service: 'sabha' });
        await userEvent.click(screen.getByText('pick-sabha'));

        expect(within(header()).getByRole('button', { name: /switch to airport seva/i }))
            .toBeInTheDocument();
    });

    it('actually moves you when tapped', async () => {
        renderShell('manager', { service: 'airport' });
        await userEvent.click(screen.getByText('pick-airport'));
        expect(dockLabels()).toContain('Arrivals');

        await userEvent.click(
            within(header()).getByRole('button', { name: /switch to sabha seva/i }));

        expect(dockLabels()).toEqual(['Dispatch', 'People', 'Fleet', 'Setup']);
    });
});

describe('the shared tab union stays safe', () => {
    it('switching services resets the tab, so no switch statement is handed a stranger', async () => {
        renderShell('manager', { service: 'airport', tab: 'records' });

        await userEvent.click(screen.getByText('goto-records'));
        expect(screen.getByTestId('current-tab')).toHaveTextContent('records');

        await userEvent.click(screen.getByText('pick-airport'));
        expect(screen.getByTestId('current-tab')).toHaveTextContent('airport-board');
    });

    it('so the dock always has something selected after a switch', async () => {
        // Without the reset no nav item would match, and a manager would look down at
        // a dock with nothing lit — the exact problem the overflow highlighting exists
        // to avoid.
        renderShell('manager', { service: 'airport' });
        await userEvent.click(screen.getByText('pick-airport'));

        const selected = within(dock()).getAllByRole('button')
            .filter(b => b.className.includes('text-saffron-800'));
        expect(selected).toHaveLength(1);
        expect(selected[0]).toHaveTextContent('Arrivals');
    });
});

describe('the choice is remembered', () => {
    it('is written to storage, so the launcher is not a tap every session', async () => {
        renderShell('manager', { service: 'airport' });
        await userEvent.click(screen.getByText('pick-airport'));

        expect(window.localStorage.getItem(SERVICE_STORAGE_KEY)).toBe('airport');
    });

    it('is read back on the next mount', () => {
        window.localStorage.setItem(SERVICE_STORAGE_KEY, 'airport');
        renderShell('driver');

        expect(dockLabels()).toEqual(['Arrivals', 'My pickup', 'Profile']);
    });

    it('ignores a junk value rather than trusting it', () => {
        // A stale or hand-edited key must land on the launcher, not on a third
        // service that does not exist.
        window.localStorage.setItem(SERVICE_STORAGE_KEY, 'spaceship');
        renderShell('driver');

        expect(dockLabels()).toEqual(['Dashboard', 'History', 'Profile']);
    });
});
