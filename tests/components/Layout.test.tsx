/**
 * Focus mode must not remount the page underneath it.
 *
 * THE BUG
 * -------
 * ResponsiveLayout used to early-return a different tree in focus mode:
 *
 *     focus   <div>{children}</div>
 *     normal  <div><div><main><div>{children}</div></main></div></div>
 *
 * React reconciles by position, so toggling `isFocusMode` did not just hide the
 * chrome — it unmounted and remounted everything below it.
 *
 * `ActiveRide` sets focus mode in a mount effect and clears it on cleanup, which
 * is a perfectly reasonable thing for a full-screen view to do. Against that
 * layout it became a loop: mount → setFocusMode(true) → tree reshapes → unmount
 * → cleanup setFocusMode(false) → tree reshapes back → mount → …
 *
 * The driver saw the page blinking, then blank, because React eventually threw
 * "Maximum update depth exceeded" and the ErrorBoundary swallowed the screen.
 * It happened at the worst possible moment: **immediately after a successful
 * assignment**, with riders already committed to that driver in Firestore. The
 * dispatch was correct and the driver could not see it.
 *
 * These tests count MOUNTS, not renders. A re-render is fine and expected; a
 * remount is the defect, and it is the only thing that distinguishes the broken
 * layout from the fixed one.
 */

import React, { useEffect, useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        userProfile: { name: 'Asha' },
        logout: vi.fn(),
        currentUser: { uid: 'driver_1' },
        getAvailableRoles: () => ['driver'],
        activeRole: 'driver',
        setActiveRole: vi.fn(),
    }),
}));

import { ResponsiveLayout } from '../../components/Layout';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';

/**
 * Stands in for ActiveRide: claims the viewport on mount, releases on unmount.
 * Records every mount so a remount loop is visible as a number.
 */
const FocusScreen: React.FC<{ onMount: () => void }> = ({ onMount }) => {
    const { setFocusMode } = useNavigation();

    useEffect(() => {
        onMount();
        setFocusMode(true);
        return () => setFocusMode(false);
    }, [setFocusMode, onMount]);

    return <div data-testid="focus-screen">Run in progress</div>;
};

/** Counts renders without causing any. */
const Counter: React.FC<{ label: string; renders: React.MutableRefObject<number> }> = ({ label, renders }) => {
    renders.current += 1;
    return <span>{label}</span>;
};

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

describe('ResponsiveLayout — focus mode does not remount the page', () => {
    it('mounts a focus-mode screen exactly once', async () => {
        const onMount = vi.fn();

        render(
            <NavigationProvider>
                <ResponsiveLayout role="driver">
                    <FocusScreen onMount={onMount} />
                </ResponsiveLayout>
            </NavigationProvider>
        );

        await waitFor(() => expect(screen.getByTestId('focus-screen')).toBeInTheDocument());

        // The whole bug in one assertion. Against the early-return layout this
        // climbed until React threw.
        expect(onMount).toHaveBeenCalledTimes(1);
    });

    it('is still mounted once after the effects have settled', async () => {
        const onMount = vi.fn();

        render(
            <NavigationProvider>
                <ResponsiveLayout role="driver">
                    <FocusScreen onMount={onMount} />
                </ResponsiveLayout>
            </NavigationProvider>
        );

        // Give any loop several ticks to reveal itself rather than asserting on
        // the first frame, which the broken version would also have passed.
        await new Promise(r => setTimeout(r, 50));

        expect(onMount).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('focus-screen')).toBeInTheDocument();
    });

    it('preserves child state across the switch into focus mode', async () => {
        // A remount silently resets state. This is the same defect stated as the
        // thing a driver would actually lose — a half-filled screen going blank.
        const Stateful: React.FC = () => {
            const { setFocusMode } = useNavigation();
            const mounted = useRef(0);
            if (mounted.current === 0) mounted.current = Date.now();

            useEffect(() => {
                setFocusMode(true);
                return () => setFocusMode(false);
            }, [setFocusMode]);

            return <span data-testid="born">{mounted.current}</span>;
        };

        render(
            <NavigationProvider>
                <ResponsiveLayout role="driver"><Stateful /></ResponsiveLayout>
            </NavigationProvider>
        );

        const first = screen.getByTestId('born').textContent;
        await new Promise(r => setTimeout(r, 50));

        expect(screen.getByTestId('born').textContent).toBe(first);
    });
});

describe('ResponsiveLayout — focus mode still hides the chrome', () => {
    it('hides the sidebar, header and bottom nav while focused', async () => {
        render(
            <NavigationProvider>
                <ResponsiveLayout role="driver">
                    <FocusScreen onMount={vi.fn()} />
                </ResponsiveLayout>
            </NavigationProvider>
        );

        await waitFor(() => expect(screen.getByTestId('focus-screen')).toBeInTheDocument());

        // The point of focus mode: a run screen read at arm's length in a car
        // should not be sharing the viewport with two nav bars.
        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.queryByText('Sabha Ride Seva')).toBeNull();
        expect(screen.queryByText('History')).toBeNull();
    });

    it('shows the chrome when not focused', () => {
        render(
            <NavigationProvider>
                <ResponsiveLayout role="driver"><div data-testid="page">Page body</div></ResponsiveLayout>
            </NavigationProvider>
        );

        expect(screen.getByTestId('page')).toBeInTheDocument();
        // Sidebar/header carry the product name; its presence is the chrome.
        expect(screen.getAllByText(/Sabha Ride/i).length).toBeGreaterThan(0);
    });

    it('does not re-render the child once per chrome element', async () => {
        // Guards the fix itself: toggling siblings must not make the child churn.
        const renders = { current: 0 };

        render(
            <NavigationProvider>
                <ResponsiveLayout role="driver">
                    <Counter label="child" renders={renders} />
                </ResponsiveLayout>
            </NavigationProvider>
        );

        await new Promise(r => setTimeout(r, 50));

        // Not asserting exactly 1 — StrictMode and provider updates legitimately
        // re-render. Asserting it is bounded, which a loop never is.
        expect(renders.current).toBeLessThan(5);
    });
});
