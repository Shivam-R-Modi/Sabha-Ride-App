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
    storedDoc = {
        enabled: true, daysOfWeek: [5], startTime: '19:00', endTime: '22:00',
        weeksAhead: 6, generatedThrough: '2026-09-26',
    };
    updateSabhaRecurrence.mockResolvedValue({ config: storedDoc, created: ['2026-08-21'] });
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

    it('says plainly that changes do not rewrite existing dates', async () => {
        // The single most misreadable thing about this feature. A manager who
        // expects a pattern change to move next week's sabha would call it broken.
        render(<RecurringSabha />);

        await waitFor(() => expect(save()).toBeInTheDocument());
        expect(screen.getByText(/not on the calendar yet/i)).toBeInTheDocument();
        expect(screen.getByText(/will not come back/i)).toBeInTheDocument();
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

    it('NEVER sends generatedThrough', async () => {
        // Server-owned. A client that can move the watermark can resurrect every
        // date the manager deleted.
        const user = userEvent.setup();
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(save());

        await waitFor(() => expect(updateSabhaRecurrence).toHaveBeenCalled());
        expect(updateSabhaRecurrence.mock.calls[0]![0]).not.toHaveProperty('generatedThrough');
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

    it('reports how many dates were actually created', async () => {
        const user = userEvent.setup();
        updateSabhaRecurrence.mockResolvedValue({ config: storedDoc, created: ['a', 'b', 'c'] });
        render(<RecurringSabha />);
        await waitFor(() => expect(save()).toBeInTheDocument());

        await user.click(save());

        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(
            expect.stringMatching(/Added 3 dates/)));
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
