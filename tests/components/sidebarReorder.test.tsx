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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('dragging a tab', () => {
    /**
     * A drag is four events. jsdom will not synthesise them from a gesture, and a
     * bare `new Event('dragstart')` is not a DragEvent — React's delegation
     * ignores it, so the handlers never run and the test passes for no reason.
     * fireEvent builds the shape React listens for.
     */
    const dragOnto = (fromLabel: string, toLabel: string) => {
        // Stores and returns, like the real thing. A stub with a hardcoded
        // getData hid a mismatch between what dragstart writes and what drop
        // reads — the two halves agreeing is most of what this is testing.
        const store = new Map<string, string>();
        const dataTransfer = {
            effectAllowed: '',
            setData: (type: string, value: string) => { store.set(type, value); },
            getData: (type: string) => store.get(type) ?? '',
        };
        const from = handle(fromLabel);
        const to = tab(toLabel);
        fireEvent.dragStart(from, { dataTransfer });
        fireEvent.dragOver(to, { dataTransfer });
        fireEvent.drop(to, { dataTransfer });
        fireEvent.dragEnd(from, { dataTransfer });
    };

    it('every tab has a drag handle', () => {
        renderSidebar();

        for (const label of DEFAULT_LABELS) {
            expect(handle(label).getAttribute('draggable')).toBe('true');
        }
    });

    it('the row itself is NOT draggable', () => {
        // A drag begun on the button and released before the browser's drag
        // threshold is a click — so an intended reorder would navigate instead.
        // The handle sits outside the button so a grab is never a navigation.
        renderSidebar();

        for (const label of DEFAULT_LABELS) {
            expect(tab(label).getAttribute('draggable')).not.toBe('true');
        }
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

    it('reorders on drop', async () => {
        renderSidebar();

        dragOnto('Records', 'Dispatch');

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect((lastWrite()!['navOrder.manager'] as string[])[0]).toBe('records');
    });

    it('does not navigate', async () => {
        // A drag that ends on a button must not also activate it.
        renderSidebar();

        dragOnto('Records', 'Fleet');

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect(tab('Dispatch').className).toMatch(/bg-cream-400/);
    });

    it('does nothing when dropped on itself', async () => {
        renderSidebar();

        dragOnto('Fleet', 'Fleet');

        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('reorders on a drop that arrives before the dragstart has rendered', async () => {
        // Found in a browser, not here: firing all four events in one tick left
        // the drop reading React state that had not committed, and it silently
        // did nothing. A real gesture leaves hundreds of milliseconds between
        // them and would never have shown it. The dragged id now comes from the
        // dataTransfer, which the platform provides for exactly this.
        renderSidebar();

        const to = tab('Dispatch');
        fireEvent.drop(to, { dataTransfer: { getData: () => 'records', setData: vi.fn(), effectAllowed: '' } });

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect((lastWrite()!['navOrder.manager'] as string[])[0]).toBe('records');
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
