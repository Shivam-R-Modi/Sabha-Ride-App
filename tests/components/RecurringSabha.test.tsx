/**
 * The control that stops the calendar running dry.
 *
 * The failure worth guarding is the familiar one: a Save button that reports
 * success without sending anything, or that sends the server-owned watermark and
 * resurrects dates the manager deleted. Both are asserted on the payload, not on
 * the toast.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateSabhaRecurrence = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let storedDoc: any;

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: () => ({}),
    onSnapshot: (_ref: unknown, next: any) => {
        next({ data: () => storedDoc });
        return () => undefined;
    },
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    updateSabhaRecurrence: (...a: any[]) => updateSabhaRecurrence(...a),
}));
vi.mock('../../contexts/ToastContext', () => ({
    useToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { RecurringSabha } from '../../components/manager/RecurringSabha';

beforeEach(() => {
    vi.clearAllMocks();
    storedDoc = { enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00' };
    updateSabhaRecurrence.mockResolvedValue({ rule: storedDoc });
});

const save = () => screen.getByRole('button', { name: /save schedule/i });

describe('RecurringSabha', () => {
    it('shows the stored pattern', async () => {
        render(<RecurringSabha />);

        await waitFor(() => expect(save()).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('says it repeats with no end date, and what an edited week keeps', async () => {
        // The two things a manager cannot infer. The first version of this card
        // asked for a number of weeks; now there is no horizon at all, and a week
        // edited individually keeps its own arrangements rather than following a
        // later change to the pattern.
        render(<RecurringSabha />);

        await waitFor(() => expect(save()).toBeInTheDocument());
        expect(screen.getByText(/until you change it/i)).toBeInTheDocument();
        expect(screen.getByText(/keep their own arrangements/i)).toBeInTheDocument();
    });

    it('offers NO horizon input — the generator is gone', async () => {
        // A spinbutton here would mean the materialising version came back.
        render(<RecurringSabha />);

        await waitFor(() => expect(save()).toBeInTheDocument());
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
        expect(screen.queryByText(/weeks ahead/i)).not.toBeInTheDocument();
    });

    it('sends the edited pattern', async () => {
        const user = userEvent.setup();
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Sunday' }));
        await user.click(save());

        await waitFor(() => expect(updateSabhaRecurrence).toHaveBeenCalledTimes(1));
        expect(updateSabhaRecurrence.mock.calls[0]![0]).toMatchObject({
            enabled: true,
            daysOfWeek: [0, 5],
            startTime: '19:00',
            endTime: '22:00',
        });
    });

    it('sends NO horizon and NO watermark', async () => {
        // Both belonged to the generator. Sending either would be the client
        // asking for behaviour the server has deleted.
        const user = userEvent.setup();
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(save());

        await waitFor(() => expect(updateSabhaRecurrence).toHaveBeenCalled());
        const sent = updateSabhaRecurrence.mock.calls[0]![0];
        expect(sent).not.toHaveProperty('generatedThrough');
        expect(sent).not.toHaveProperty('weeksAhead');
        expect(Object.keys(sent).sort()).toEqual(['daysOfWeek', 'enabled', 'endTime', 'startTime']);
    });

    it('refuses to save an enabled pattern with no days, and says why', async () => {
        const user = userEvent.setup();
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Friday' }));
        await user.click(save());

        expect(await screen.findByRole('alert')).toHaveTextContent(/at least one day/i);
        expect(updateSabhaRecurrence).not.toHaveBeenCalled();
    });

    it('lets a half-edited pattern still be turned OFF', async () => {
        // Otherwise a manager cannot stop it generating without first fixing a
        // form they no longer care about.
        const user = userEvent.setup();
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Friday' })); // now zero days
        await user.click(screen.getByRole('checkbox'));                    // disable
        await user.click(save());

        await waitFor(() => expect(updateSabhaRecurrence).toHaveBeenCalled());
        expect(updateSabhaRecurrence.mock.calls[0]![0].enabled).toBe(false);
    });

    it('reports the rule the SERVER stored, not what was on screen', async () => {
        // If the two ever disagree, the manager should see the server's version.
        const user = userEvent.setup();
        updateSabhaRecurrence.mockResolvedValue({
            rule: { enabled: true, daysOfWeek: [0], startTime: '10:00', endTime: '12:00' },
        });
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(save());

        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(
            expect.stringMatching(/Every Sunday, 10:00 AM–12:00 PM, repeating until you change it/)));
    });

    it('does not claim success when the server refuses', async () => {
        const user = userEvent.setup();
        updateSabhaRecurrence.mockRejectedValue(new Error('Pick at least one day'));
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(save());

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(toastSuccess).not.toHaveBeenCalled();
        expect(await screen.findByRole('alert')).toHaveTextContent(/at least one day/i);
    });

    it('names every day button for a screen reader', async () => {
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        for (const name of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
            expect(screen.getByRole('button', { name })).toBeInTheDocument();
        }
    });
});
