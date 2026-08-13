/**
 * The replacement for the 27 `alert()` calls.
 *
 * The behaviour that matters most is the one an alert never had and a careless
 * toast implementation loses: ERRORS MUST NOT DISAPPEAR ON THEIR OWN. A success
 * message that fades is fine. A failure that fades is a failure nobody saw,
 * which is the same "silently does nothing" class this codebase keeps removing —
 * just with a five-second delay bolted on.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ToastProvider, useToast } from '../../contexts/ToastContext';

const Trigger: React.FC = () => {
    const toast = useToast();
    return (
        <>
            <button onClick={() => toast.success('Driver approved.')}>fire success</button>
            <button onClick={() => toast.error('Could not unassign that rider.')}>fire error</button>
            <button onClick={() => toast.info('Nothing to download.')}>fire info</button>
        </>
    );
};

const renderApp = () => render(<ToastProvider><Trigger /></ToastProvider>);

const fire = async (which: 'success' | 'error' | 'info') => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await user.click(screen.getByRole('button', { name: `fire ${which}` }));
    return user;
};

// `shouldAdvanceTime` matters: userEvent schedules its own work on timers, so a
// fully frozen clock starves it and every interaction hangs until the test times
// out. This keeps real time ticking while still allowing advanceTimersByTime to
// jump the five-second auto-dismiss.
// Braces, not a concise body: `vi.useFakeTimers()` returns VitestUtils, and
// returning it hands vitest a bogus cleanup callback.
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('toasts appear', () => {
    it('shows a success message', async () => {
        await fire('success');
        expect(screen.getByText('Driver approved.')).toBeInTheDocument();
    });

    it('shows an error message', async () => {
        await fire('error');
        expect(screen.getByText('Could not unassign that rider.')).toBeInTheDocument();
    });

    it('shows nothing until something happens', () => {
        renderApp();
        expect(screen.queryByRole('status')?.textContent ?? '').toBe('');
    });

    it('stacks several at once rather than replacing', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderApp();

        await user.click(screen.getByRole('button', { name: 'fire error' }));
        await user.click(screen.getByRole('button', { name: 'fire success' }));

        expect(screen.getByText('Could not unassign that rider.')).toBeInTheDocument();
        expect(screen.getByText('Driver approved.')).toBeInTheDocument();
    });
});

describe('errors persist, confirmations do not', () => {
    it('auto-dismisses a success after a few seconds', async () => {
        await fire('success');
        expect(screen.getByText('Driver approved.')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(6000); });

        expect(screen.queryByText('Driver approved.')).not.toBeInTheDocument();
    });

    it('auto-dismisses an info the same way', async () => {
        await fire('info');
        act(() => { vi.advanceTimersByTime(6000); });
        expect(screen.queryByText('Nothing to download.')).not.toBeInTheDocument();
    });

    it('NEVER auto-dismisses an error', async () => {
        await fire('error');

        // Well past any plausible auto-dismiss.
        act(() => { vi.advanceTimersByTime(120_000); });

        expect(screen.getByText('Could not unassign that rider.')).toBeInTheDocument();
    });
});

describe('dismissing by hand', () => {
    it('lets the user close an error', async () => {
        const user = await fire('error');

        await user.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(screen.queryByText('Could not unassign that rider.')).not.toBeInTheDocument();
    });

    it('closes only the one that was dismissed', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderApp();
        await user.click(screen.getByRole('button', { name: 'fire error' }));
        await user.click(screen.getByRole('button', { name: 'fire success' }));

        const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss' });
        await user.click(dismissButtons[0]);

        expect(screen.queryByText('Could not unassign that rider.')).not.toBeInTheDocument();
        expect(screen.getByText('Driver approved.')).toBeInTheDocument();
    });
});

describe('announcement', () => {
    it('puts errors in an assertive region so they interrupt', async () => {
        await fire('error');
        const region = screen.getByRole('alert');
        expect(region).toHaveAttribute('aria-live', 'assertive');
        expect(region).toHaveTextContent('Could not unassign that rider.');
    });

    it('puts confirmations in a polite region so they wait their turn', async () => {
        await fire('success');
        const region = screen.getByRole('status');
        expect(region).toHaveAttribute('aria-live', 'polite');
        expect(region).toHaveTextContent('Driver approved.');
    });

    it('does not steal focus the way alert() did', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderApp();
        const button = screen.getByRole('button', { name: 'fire error' });

        await user.click(button);

        // alert() blocked the page and moved focus. Being announced without
        // being interrupted is better for a screen-reader user, not worse.
        expect(button).toHaveFocus();
    });
});

describe('misuse is loud', () => {
    it('throws if used outside a provider', () => {
        // A silent no-op here would recreate the exact bug this replaces: a
        // failure with nothing on screen to show for it.
        const Orphan = () => { useToast(); return null; };
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => render(<Orphan />)).toThrow(/ToastProvider/);

        quiet.mockRestore();
    });
});
