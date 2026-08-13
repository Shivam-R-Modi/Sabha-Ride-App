/**
 * The in-app replacement for window.confirm.
 *
 * This exists because a suppressed native confirm() returns false, so every
 * destructive button in the app took the "user said no" branch and did nothing
 * at all. It is the single most load-bearing piece of shared UI in the repo —
 * every destructive action routes through it — and it had no test.
 *
 * The redesign will restyle this dialog. These assertions are about what it
 * resolves and what it announces, so the restyle cannot quietly break the guard.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { useConfirm, type ConfirmOptions } from '../../components/shared/useConfirm';

/** A button that asks, and reports what it was told. */
const Harness: React.FC<{ options: ConfirmOptions; onAnswer: (ok: boolean) => void }> = ({
    options,
    onAnswer,
}) => {
    const { ask, confirmDialog } = useConfirm();
    return (
        <>
            <button onClick={async () => onAnswer(await ask(options))}>Do the thing</button>
            {confirmDialog}
        </>
    );
};

const open = async (options: ConfirmOptions) => {
    const answered = vi.fn();
    const user = userEvent.setup();
    render(<Harness options={options} onAnswer={answered} />);
    await user.click(screen.getByRole('button', { name: 'Do the thing' }));
    return { user, answered };
};

describe('useConfirm', () => {
    it('shows nothing until something asks', () => {
        render(<Harness options={{ message: 'x' }} onAnswer={vi.fn()} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('announces itself as a modal dialog', async () => {
        await open({ message: 'Delete this ride?' });

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('shows the question it was given', async () => {
        await open({ title: 'Dismiss this request?', message: 'The rider will not get a ride.' });

        expect(screen.getByText('Dismiss this request?')).toBeInTheDocument();
        expect(screen.getByText('The rider will not get a ride.')).toBeInTheDocument();
    });

    it('resolves true when confirmed', async () => {
        const { user, answered } = await open({ message: 'Go ahead?', confirmLabel: 'Go ahead' });

        await user.click(screen.getByRole('button', { name: 'Go ahead' }));

        expect(answered).toHaveBeenCalledWith(true);
    });

    it('resolves false when cancelled', async () => {
        const { user, answered } = await open({ message: 'Go ahead?', cancelLabel: 'Never mind' });

        await user.click(screen.getByRole('button', { name: 'Never mind' }));

        expect(answered).toHaveBeenCalledWith(false);
    });

    it('resolves false when dismissed by clicking away — and resolves, rather than hanging', async () => {
        // A promise that never settles would leave the caller's `await` parked
        // forever, which is the inert-button failure wearing a different hat.
        const { user, answered } = await open({ message: 'Go ahead?' });

        // The backdrop is the dialog's parent. Clicking the dialog itself must
        // NOT cancel — see the next test.
        await user.click(screen.getByRole('dialog').parentElement as Element);

        expect(answered).toHaveBeenCalledWith(false);
    });

    it('does not cancel when the click lands inside the dialog', async () => {
        const { user, answered } = await open({ message: 'Go ahead?' });

        await user.click(screen.getByText('Go ahead?'));

        expect(answered).not.toHaveBeenCalled();
    });

    it('cancels on Escape', async () => {
        // New since the migration to <Sheet>. The hand-rolled overlay ignored
        // the key entirely.
        const { user, answered } = await open({ message: 'Go ahead?' });

        await user.keyboard('{Escape}');

        expect(answered).toHaveBeenCalledWith(false);
    });

    it('closes once answered', async () => {
        const { user } = await open({ message: 'Go ahead?' });

        await user.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('defaults to a cautious pair of labels', async () => {
        await open({ message: 'Go ahead?' });

        expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    });

    it('names the destructive action for what it is', async () => {
        await open({ message: 'This cannot be undone.', destructive: true });

        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('puts focus on the safe choice, not the destructive one', async () => {
        await open({ message: 'This cannot be undone.', destructive: true });

        // A stray Enter must not delete anything.
        expect(screen.getByRole('button', { name: 'Go back' })).toHaveFocus();
    });
});
