/**
 * A manager can put their own tabs in their own order — and cannot lose one.
 *
 * The order lives on the user document, per role, so it follows the person
 * between a laptop and a desktop. `applyOrder` is what makes that safe and has
 * its own tests; these are about the sidebar actually using it, and about the
 * three ways a reorder UI goes wrong in practice:
 *
 *   1. **A tab disappears.** Rendering the stored list instead of the resolved
 *      one hides any destination saved before it existed. Nothing looks broken.
 *   2. **A drag navigates.** The nav buttons are still buttons. Layout.tsx
 *      already carries a long note about the bottom-nav swipe firing the button
 *      underneath it; this is the same trap in a new place.
 *   3. **The keyboard is left out.** HTML5 drag is mouse-only, so without
 *      Alt+arrow a keyboard user cannot reorder at all.
 *
 * The write is asserted on the PAYLOAD — which role, which ids — not on whether
 * a spy was called. A reorder that saves the wrong role's order looks perfect
 * until you sign in somewhere else.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

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
vi.mock('../../components/shared/InstallAppButton', () => ({
    InstallAppButton: () => null,
}));

import { ResponsiveLayout } from '../../components/Layout';
import { NavigationProvider } from '../../contexts/NavigationContext';

/** The manager's default order, as getNavItems declares it. */
const DEFAULT_LABELS = ['Dispatch', 'People', 'Reports', 'Fleet', 'Setup', 'Profile', 'Notices', 'Records'];

const renderSidebar = () => render(
    <NavigationProvider>
        <ResponsiveLayout role="manager"><div>page</div></ResponsiveLayout>
    </NavigationProvider>,
);

/** The sidebar's nav buttons, in the order they appear. */
const tabOrder = () => {
    const nav = document.querySelector('aside nav')!;
    return [...nav.querySelectorAll('button')]
        .map(b => b.textContent?.trim())
        .filter(text => text && DEFAULT_LABELS.includes(text));
};

const tab = (label: string) => {
    const nav = document.querySelector('aside nav')!;
    return [...nav.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
};

/** The grip beside a tab — the only draggable part of the row. */
const handle = (label: string) => {
    const nav = document.querySelector('aside nav')!;
    return nav.querySelector(`[aria-label="Reorder ${label}"]`)!;
};

/** The `navOrder.<role>` value of the last write. */
const lastWrite = () => {
    const call = [...updateDoc.mock.calls].reverse()[0] as unknown as [unknown, Record<string, unknown>];
    return call ? call[1] : null;
};

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    profile = { name: 'Mira' };
});

describe('the default order, when nothing has been chosen', () => {
    it('is the order getNavItems declares', () => {
        renderSidebar();

        expect(tabOrder()).toEqual(DEFAULT_LABELS);
    });

    it('offers no Reset, because there is nothing to reset', () => {
        // A Reset that resets nothing is the dead control this repo keeps deleting.
        renderSidebar();

        expect(screen.queryByRole('button', { name: /reset tab order/i })).toBeNull();
    });
});

describe('a stored order', () => {
    it('is what the sidebar shows', () => {
        profile = { name: 'Mira', navOrder: { manager: ['records', 'fleet'] } };
        renderSidebar();

        expect(tabOrder().slice(0, 2)).toEqual(['Records', 'Fleet']);
    });

    it('cannot hide a tab it has never heard of', () => {
        // The failure this feature is designed against: an order saved before
        // Notices existed must not remove Notices for ever, on every device.
        profile = { name: 'Mira', navOrder: { manager: ['records', 'home'] } };
        renderSidebar();

        expect(tabOrder()).toHaveLength(DEFAULT_LABELS.length);
        expect(tabOrder()).toContain('Notices');
    });

    it('is ignored when it belongs to another role', () => {
        profile = { name: 'Mira', navOrder: { driver: ['profile', 'home'] } };
        renderSidebar();

        expect(tabOrder()).toEqual(DEFAULT_LABELS);
    });

    it('offers Reset once one exists', () => {
        profile = { name: 'Mira', navOrder: { manager: ['records'] } };
        renderSidebar();

        expect(screen.getByRole('button', { name: /reset tab order/i })).toBeTruthy();
    });
});

describe('moving a tab with the keyboard', () => {
    it('moves it down with Alt and ArrowDown', async () => {
        renderSidebar();

        tab('Dispatch').focus();
        await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect(lastWrite()!['navOrder.manager'])
            .toEqual(['people', 'home', 'history', 'fleet', 'setup', 'profile', 'notices', 'records']);
    });

    it('moves it up with Alt and ArrowUp', async () => {
        renderSidebar();

        tab('Reports').focus();
        await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect((lastWrite()!['navOrder.manager'] as string[]).slice(0, 3))
            .toEqual(['home', 'history', 'people']);
    });

    it('writes the whole order, not just the part that was stored', async () => {
        // A two-entry write would leave the rest to be appended by applyOrder in
        // an order nobody chose, and the next drag would compound it.
        profile = { name: 'Mira', navOrder: { manager: ['records'] } };
        renderSidebar();

        tab('Records').focus();
        await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect(lastWrite()!['navOrder.manager']).toHaveLength(DEFAULT_LABELS.length);
    });

    it('writes nothing when the tab cannot move any further', async () => {
        // Alt+Up on the first item is an ordinary thing to press. It must be a
        // no-op, not a wasted write and certainly not a lost tab.
        renderSidebar();

        tab('Dispatch').focus();
        await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');

        expect(updateDoc).not.toHaveBeenCalled();
        expect(tabOrder()).toEqual(DEFAULT_LABELS);
    });

    it('does not change tab', async () => {
        renderSidebar();

        tab('Fleet').focus();
        await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

        // Dispatch is still the selected destination — moving a tab is not
        // visiting it.
        expect(tab('Dispatch').className).toMatch(/bg-cream-400/);
    });

    it('leaves a bare arrow key alone', async () => {
        renderSidebar();

        tab('Dispatch').focus();
        await userEvent.keyboard('{ArrowDown}');

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('announces the move for a screen reader', async () => {
        renderSidebar();

        tab('Dispatch').focus();
        await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

        await waitFor(() => expect(screen.getByText(/Dispatch moved to position 2 of 8/)).toBeTruthy());
    });
});

describe('dragging a tab — with a finger as well as a mouse', () => {
    /**
     * This used to be built on HTML5 drag-and-drop, and that is why the owner
     * reported "drag does not work on mobile". `dragstart` is never produced from
     * a finger on iOS Safari or Android Chrome, so the reorder worked on a laptop
     * and did nothing at all on a phone — no error, nothing to notice.
     *
     * Pointer events replace it, one path for mouse, touch and pen. These drive
     * the same handlers a finger drives, and `pointerType` is asserted so a
     * regression to a mouse-only API cannot pass.
     */

    /** jsdom does not implement pointer capture; the drag does not depend on it. */
    const stubCapture = (el: Element) => {
        (el as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;
        (el as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => undefined;
    };

    /** Give each row a box, since jsdom measures everything as zero. */
    const layOutRows = () => {
        DEFAULT_LABELS.forEach((label, index) => {
            const row = tab(label).parentElement!;
            row.getBoundingClientRect = () => ({
                left: 0, right: 200, top: index * 50, bottom: index * 50 + 50,
                width: 200, height: 50, x: 0, y: index * 50, toJSON: () => ({}),
            }) as DOMRect;
        });
    };

    /** Drag `fromLabel`'s handle onto `toLabel`'s row, as a finger would. */
    const dragOnto = (fromLabel: string, toLabel: string, pointerType = 'touch') => {
        layOutRows();
        const grip = handle(fromLabel);
        stubCapture(grip);
        const targetIndex = DEFAULT_LABELS.indexOf(toLabel);
        const y = targetIndex * 50 + 25;

        fireEvent.pointerDown(grip, { pointerId: 1, button: 0, pointerType, clientX: 100, clientY: 0 });
        fireEvent.pointerMove(grip, { pointerId: 1, pointerType, clientX: 100, clientY: y });
        fireEvent.pointerUp(grip, { pointerId: 1, pointerType, clientX: 100, clientY: y });
    };

    it('every tab has a drag handle', () => {
        renderSidebar();

        for (const label of DEFAULT_LABELS) {
            expect(handle(label)).toBeTruthy();
        }
    });

    it('the handle does not use the mouse-only drag API', () => {
        // `draggable` is what did not work on a phone. Its absence is the fix.
        renderSidebar();

        expect(handle('Fleet').getAttribute('draggable')).toBeNull();
        expect(tab('Fleet').getAttribute('draggable')).toBeNull();
    });

    it('lets the browser keep no part of the gesture', () => {
        // Without `touch-action: none` the browser claims the gesture for
        // scrolling as soon as the finger moves, and pointermove stops arriving
        // half way through the drag.
        renderSidebar();

        expect((handle('Fleet') as HTMLElement).style.touchAction).toBe('none');
    });

    it('reorders from a TOUCH drag', () => {
        renderSidebar();

        dragOnto('Records', 'Dispatch', 'touch');

        expect((lastWrite()!['navOrder.manager'] as string[])[0]).toBe('records');
    });

    it('reorders from a MOUSE drag too', () => {
        renderSidebar();

        dragOnto('Records', 'Dispatch', 'mouse');

        expect((lastWrite()!['navOrder.manager'] as string[])[0]).toBe('records');
    });

    it('does not navigate', async () => {
        renderSidebar();

        dragOnto('Records', 'Fleet');

        expect(tab('Dispatch').className).toMatch(/bg-cream-400/);
    });

    it('does nothing when released on itself', () => {
        renderSidebar();

        dragOnto('Fleet', 'Fleet');

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('does nothing when released off the list', () => {
        // A finger dragged into the page must not land the tab somewhere random.
        renderSidebar();
        layOutRows();
        const grip = handle('Fleet');
        stubCapture(grip);

        fireEvent.pointerDown(grip, { pointerId: 1, button: 0, pointerType: 'touch', clientX: 100, clientY: 0 });
        fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientX: 900, clientY: 900 });
        fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'touch', clientX: 900, clientY: 900 });

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('does nothing when the browser takes the gesture back', () => {
        // A system swipe or an incoming call cancels the pointer. Nothing should
        // move rather than moving to wherever the finger happened to be.
        renderSidebar();
        layOutRows();
        const grip = handle('Records');
        stubCapture(grip);

        fireEvent.pointerDown(grip, { pointerId: 1, button: 0, pointerType: 'touch', clientX: 100, clientY: 350 });
        fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 25 });
        fireEvent.pointerCancel(grip, { pointerId: 1, pointerType: 'touch' });
        fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 25 });

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('ignores a right-click', () => {
        renderSidebar();
        layOutRows();
        const grip = handle('Records');
        stubCapture(grip);

        fireEvent.pointerDown(grip, { pointerId: 1, button: 2, pointerType: 'mouse', clientX: 100, clientY: 350 });
        fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 25 });
        fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 25 });

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('survives a move and a release delivered in one task', () => {
        // A fast flick: the browser can deliver the last pointermove and the
        // pointerup back to back within a single task, so React has not
        // re-rendered in between and `overId` state is still stale. The ids are
        // held in refs for exactly this, and the whole gesture goes inside ONE
        // act() here — separate fireEvent calls each flush state, which is why an
        // earlier version of this test passed against the broken code too.
        renderSidebar();
        layOutRows();
        const grip = handle('Records');
        stubCapture(grip);

        fireEvent.pointerDown(grip, { pointerId: 1, button: 0, pointerType: 'touch', clientX: 100, clientY: 350 });
        act(() => {
            grip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 25 }) as PointerEvent);
            grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 25 }) as PointerEvent);
        });

        expect((lastWrite()!['navOrder.manager'] as string[])[0]).toBe('records');
    });

    it('still reorders when the browser refuses pointer capture', () => {
        // Chrome throws NotFoundError if the pointer is not active. An unguarded
        // call there would abort the handler before the drag had even been
        // recorded — nothing moves, nothing is said. Capture is an improvement to
        // the drag, not a precondition for it.
        renderSidebar();
        layOutRows();
        const grip = handle('Records');
        (grip as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {
            throw new DOMException('No active pointer with the given id is found.', 'NotFoundError');
        };

        fireEvent.pointerDown(grip, { pointerId: 9, button: 0, pointerType: 'touch', clientX: 100, clientY: 350 });
        fireEvent.pointerMove(grip, { pointerId: 9, pointerType: 'touch', clientX: 100, clientY: 25 });
        fireEvent.pointerUp(grip, { pointerId: 9, pointerType: 'touch', clientX: 100, clientY: 25 });

        expect((lastWrite()!['navOrder.manager'] as string[])[0]).toBe('records');
    });

    it('the handle is named for the tab it moves', () => {
        renderSidebar();

        expect(handle('Fleet').getAttribute('aria-label')).toBe('Reorder Fleet');
    });

    it('a plain click on the row still navigates', async () => {
        renderSidebar();

        await userEvent.click(tab('Fleet'));

        expect(tab('Fleet').className).toMatch(/bg-cream-400/);
        expect(updateDoc).not.toHaveBeenCalled();
    });
});

describe('Records keeps its divider wherever it lands', () => {
    /**
     * The owner chose to let Records move like every other tab, with the reason
     * in front of them — it edits riders' names, phone numbers and home
     * addresses with no undo, which is why it sits last behind a rule by default.
     * The divider travelling with it is what stops that separation being lost
     * silently.
     */
    const dividers = () => document.querySelectorAll('aside nav hr').length;

    it('draws one above Records in the default order', () => {
        renderSidebar();

        expect(dividers()).toBe(1);
    });

    it('still draws one when Records sits in the middle', () => {
        profile = { name: 'Mira', navOrder: { manager: ['home', 'records', 'fleet'] } };
        renderSidebar();

        expect(tabOrder()[1]).toBe('Records');
        expect(dividers()).toBe(1);
    });

    it('draws none when Records is first, where a rule would just be a stray line', () => {
        profile = { name: 'Mira', navOrder: { manager: ['records'] } };
        renderSidebar();

        expect(tabOrder()[0]).toBe('Records');
        expect(dividers()).toBe(0);
    });
});

describe('resetting', () => {
    it('clears the stored order rather than writing a default one', async () => {
        // Writing today's default would freeze it: the next release changes the
        // default and this person keeps the old one for ever, having asked for
        // "the default".
        profile = { name: 'Mira', navOrder: { manager: ['records', 'home'] } };
        renderSidebar();

        await userEvent.click(screen.getByRole('button', { name: /reset tab order/i }));

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect(lastWrite()!['navOrder.manager']).toBe('__DELETE__');
    });
});
