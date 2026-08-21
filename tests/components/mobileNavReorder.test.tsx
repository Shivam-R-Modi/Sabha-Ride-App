/**
 * Reordering, on the surface a phone actually has.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "The drag does not work on mobile" had two causes, and the bigger one was not
 * the drag at all: the sidebar is `hidden lg:flex`, so below 1024px it does not
 * render, and every reorder handle lived on it. On a phone there was nothing to
 * drag. Measured in a browser at phone width: eight handles in the DOM, all zero
 * pixels wide.
 *
 * The other cause was the drag itself — HTML5 `dragstart` is never produced from
 * a finger — and that is covered in sidebarReorder.test.tsx.
 *
 * So the drawer, which is where a phone reaches its other destinations, now
 * carries handles too. It is reached by a swipe: that is a deliberate decision
 * recorded on GrabHandle in 2026-08-18, with its accessibility cost written down,
 * and it is NOT reversed here. The handles are exactly as reachable as the
 * destinations already in that drawer.
 *
 * ONE ORDER, TWO SURFACES. The sequence in the dock and in the drawer comes from
 * the same stored order the sidebar writes, so a manager who reorders on their
 * laptop sees it on their phone. `primary` still decides which four are docked —
 * promoting a destination into the bar is a separate decision about the default
 * four and is deliberately not taken here.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateDoc = vi.fn(async () => undefined);
let profile: Record<string, unknown> = { name: 'Mira' };

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    updateDoc: (...a: unknown[]) => updateDoc(...(a as [])),
    deleteField: () => '__DELETE__',
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        userProfile: profile,
        logout: vi.fn(),
        currentUser: { uid: 'manager_1' },
        getAvailableRoles: () => ['manager'],
        activeRole: 'manager',
        setActiveRole: vi.fn(),
    }),
}));
vi.mock('../../components/shared/InstallAppButton', () => ({ InstallAppButton: () => null }));

import { ResponsiveLayout } from '../../components/Layout';
import { NavigationProvider } from '../../contexts/NavigationContext';

const renderApp = () => render(
    <NavigationProvider>
        <ResponsiveLayout role="manager"><div>page</div></ResponsiveLayout>
    </NavigationProvider>,
);

const dock = () => document.querySelector('.clay-bottom-nav')!;
const drawer = () => document.querySelector('.clay-bottom-drawer');

const labelsIn = (root: Element) =>
    [...root.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(Boolean);

/** The swipe that opens the drawer — the only way in, by the owner's decision. */
const swipeUp = () => {
    fireEvent.touchStart(dock(), { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(dock(), { changedTouches: [{ clientY: 200 }] });
};

const drawerHandle = (label: string) =>
    drawer()!.querySelector(`[aria-label="Reorder ${label}"]`) as HTMLElement;

const drawerRow = (label: string) =>
    [...drawer()!.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!.parentElement!;

const lastWrite = () => {
    const call = [...updateDoc.mock.calls].reverse()[0] as unknown as [unknown, Record<string, unknown>];
    return call ? call[1] : null;
};

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    profile = { name: 'Mira' };
});

describe('the dock follows the same order as the sidebar', () => {
    it('shows the four primary destinations by default', () => {
        renderApp();

        expect(labelsIn(dock())).toEqual(['Dispatch', 'People', 'Fleet', 'Setup']);
    });

    it('resequences them from the stored order', () => {
        // One preference, two surfaces. A phone showing a different sequence from
        // the laptop that set it would be a second model of the same fact.
        profile = { name: 'Mira', navOrder: { manager: ['setup', 'fleet'] } };
        renderApp();

        expect(labelsIn(dock())).toEqual(['Setup', 'Fleet', 'Dispatch', 'People']);
    });

    it('does not change WHICH four are docked', () => {
        // `primary` still decides membership. Promoting Records into the bar is a
        // separate decision about the defaults, not a side effect of a drag.
        profile = { name: 'Mira', navOrder: { manager: ['records', 'notices'] } };
        renderApp();

        expect(labelsIn(dock())).not.toContain('Records');
        expect(labelsIn(dock())).toHaveLength(4);
    });
});

describe('the drawer is the phone reorder surface', () => {
    it('is closed until swiped open', () => {
        renderApp();

        expect(drawer()).toBeNull();
    });

    it('carries a handle for each destination it holds', () => {
        renderApp();
        swipeUp();

        for (const label of ['Reports', 'Profile', 'Notices', 'Records']) {
            expect(drawerHandle(label)).toBeTruthy();
        }
    });

    it('lets the browser keep no part of the gesture', () => {
        renderApp();
        swipeUp();

        expect(drawerHandle('Notices').style.touchAction).toBe('none');
    });

    it('reorders from a touch drag', () => {
        renderApp();
        swipeUp();

        // Two columns: Reports, Profile / Notices, Records.
        const rows: Array<[string, number, number]> = [
            ['Reports', 0, 0], ['Profile', 100, 0], ['Notices', 0, 50], ['Records', 100, 50],
        ];
        for (const [label, x, y] of rows) {
            drawerRow(label).getBoundingClientRect = () => ({
                left: x, right: x + 100, top: y, bottom: y + 50,
                width: 100, height: 50, x, y, toJSON: () => ({}),
            }) as DOMRect;
        }

        const grip = drawerHandle('Records');
        (grip as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;

        fireEvent.pointerDown(grip, { pointerId: 1, button: 0, pointerType: 'touch', clientX: 150, clientY: 75 });
        fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 25 });
        fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 25 });

        // Records took Reports' place, so it now precedes it.
        const written = lastWrite()!['navOrder.manager'] as string[];
        expect(written.indexOf('records')).toBeLessThan(written.indexOf('history'));
    });

    it('writes the whole order, so the dock and the sidebar agree', () => {
        renderApp();
        swipeUp();

        for (const [label, y] of [['Reports', 0], ['Profile', 0], ['Notices', 50], ['Records', 50]] as Array<[string, number]>) {
            drawerRow(label).getBoundingClientRect = () => ({
                left: 0, right: 200, top: y, bottom: y + 50,
                width: 200, height: 50, x: 0, y, toJSON: () => ({}),
            }) as DOMRect;
        }

        const grip = drawerHandle('Notices');
        (grip as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;

        fireEvent.pointerDown(grip, { pointerId: 1, button: 0, pointerType: 'touch', clientX: 50, clientY: 75 });
        fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 25 });
        fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 25 });

        expect(lastWrite()!['navOrder.manager']).toHaveLength(8);
    });

    it('a tap on a drawer destination still navigates', async () => {
        // The handle sits on top of the row. It must not swallow the tap that
        // the drawer exists for.
        renderApp();
        swipeUp();

        const notices = [...drawer()!.querySelectorAll('button')]
            .find(b => b.textContent?.trim() === 'Notices')!;
        fireEvent.click(notices);

        await waitFor(() => expect(drawer()).toBeNull());
        expect(updateDoc).not.toHaveBeenCalled();
    });
});
