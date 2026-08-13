/**
 * Approvals.
 *
 * These decisions gate access to an app holding children's names, phone numbers
 * and home addresses, so the tests care about two things above appearance: that
 * turning someone down asks first, and that a failure is never silent.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const usePendingDrivers = vi.fn();
const usePendingRiders = vi.fn();
const updateUserStatus = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useFirestore', () => ({
    usePendingDrivers: () => usePendingDrivers(),
    usePendingRiders: () => usePendingRiders(),
    updateUserStatus: (...a: unknown[]) => updateUserStatus(...a),
}));

import { ManagerPeople } from '../../components/manager/ManagerPeople';
import { ToastProvider } from '../../contexts/ToastContext';

const show = () => render(<ToastProvider><ManagerPeople /></ToastProvider>);

const aDriver = { id: 'drv1', name: 'Ramesh Patel', phone: '+15550001111', carModel: 'Odyssey' };
const aRider = { id: 'rdr1', name: 'Anita Shah', phone: '+15550002222', address: '12 Maple Ave' };

beforeEach(() => {
    usePendingDrivers.mockReturnValue({ pendingDrivers: [aDriver], loading: false });
    usePendingRiders.mockReturnValue({ pendingRiders: [aRider], loading: false });
});

describe('ManagerPeople — the queue', () => {
    it('separates drivers from riders', () => {
        show();
        expect(screen.getByText(/Drivers · 1/)).toBeInTheDocument();
        expect(screen.getByText(/Riders · 1/)).toBeInTheDocument();
    });

    it('counts everyone waiting', () => {
        show();
        expect(screen.getByText('2 waiting to be approved.')).toBeInTheDocument();
    });

    it('shows what there is to judge a driver on', () => {
        show();
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
        expect(screen.getByText('+15550001111')).toBeInTheDocument();
        expect(screen.getByText('Odyssey')).toBeInTheDocument();
    });

    it('shows what there is to judge a rider on', () => {
        show();
        expect(screen.getByText('Anita Shah')).toBeInTheDocument();
        expect(screen.getByText('12 Maple Ave')).toBeInTheDocument();
    });

    it('says so when nobody is waiting', () => {
        usePendingDrivers.mockReturnValue({ pendingDrivers: [], loading: false });
        usePendingRiders.mockReturnValue({ pendingRiders: [], loading: false });
        show();
        expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
    });

    it('does not claim "all caught up" before the data arrives', () => {
        // Telling a manager nobody is waiting, when in fact nothing has loaded,
        // sends them away from a queue of people.
        usePendingDrivers.mockReturnValue({ pendingDrivers: [], loading: true });
        usePendingRiders.mockReturnValue({ pendingRiders: [], loading: true });
        show();
        expect(screen.queryByText(/All caught up/i)).not.toBeInTheDocument();
        expect(screen.getByLabelText(/loading approvals/i)).toBeInTheDocument();
    });

    it('does not mix ride requests in — those belong to Dispatch', () => {
        // The old bell-icon modal listed driver approvals, rider approvals AND
        // pending ride requests, the last duplicating the screen behind it.
        show();
        expect(screen.queryByText(/ride request/i)).not.toBeInTheDocument();
    });
});

describe('ManagerPeople — approving', () => {
    it('approves without an extra confirmation, because it is reversible', async () => {
        const user = userEvent.setup();
        show();

        await user.click(screen.getAllByRole('button', { name: /approve/i })[0]);

        await waitFor(() => expect(updateUserStatus).toHaveBeenCalledWith('drv1', 'approved'));
    });

    it('confirms it happened', async () => {
        const user = userEvent.setup();
        show();

        await user.click(screen.getAllByRole('button', { name: /approve/i })[0]);

        expect(await screen.findByText(/Ramesh Patel approved/i)).toBeInTheDocument();
    });

    it('reports a failure rather than looking like it worked', async () => {
        const user = userEvent.setup();
        updateUserStatus.mockRejectedValueOnce(new Error('Permission denied'));
        show();

        await user.click(screen.getAllByRole('button', { name: /approve/i })[0]);

        expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    });
});

describe('ManagerPeople — turning someone down', () => {
    it('asks first', async () => {
        const user = userEvent.setup();
        show();

        await user.click(screen.getAllByRole('button', { name: /turn down/i })[0]);

        expect(await screen.findByRole('dialog', { name: /turn down ramesh patel/i }))
            .toBeInTheDocument();
        expect(updateUserStatus).not.toHaveBeenCalled();
    });

    it('does nothing if the manager backs out', async () => {
        const user = userEvent.setup();
        show();

        await user.click(screen.getAllByRole('button', { name: /turn down/i })[0]);
        await user.click(await screen.findByRole('button', { name: /go back/i }));

        expect(updateUserStatus).not.toHaveBeenCalled();
    });

    it('rejects once confirmed', async () => {
        const user = userEvent.setup();
        show();

        await user.click(screen.getAllByRole('button', { name: /turn down/i })[0]);
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Turn down' }));

        await waitFor(() => expect(updateUserStatus).toHaveBeenCalledWith('drv1', 'rejected'));
    });

    it('spells out the consequence for a driver', async () => {
        const user = userEvent.setup();
        show();
        await user.click(screen.getAllByRole('button', { name: /turn down/i })[0]);
        expect(await screen.findByText(/will not be able to volunteer/i)).toBeInTheDocument();
    });

    it('spells out the consequence for a rider', async () => {
        const user = userEvent.setup();
        show();
        await user.click(screen.getAllByRole('button', { name: /turn down/i })[1]);
        expect(await screen.findByText(/will not be able to request rides/i)).toBeInTheDocument();
    });
});
