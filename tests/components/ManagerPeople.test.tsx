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
const useRoleUpgradeRequests = vi.fn();
const updateUserStatus = vi.fn().mockResolvedValue(undefined);
const declineRoleUpgrade = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useFirestore', () => ({
    usePendingDrivers: () => usePendingDrivers(),
    usePendingRiders: () => usePendingRiders(),
    useRoleUpgradeRequests: () => useRoleUpgradeRequests(),
    updateUserStatus: (...a: unknown[]) => updateUserStatus(...a),
    declineRoleUpgrade: (...a: unknown[]) => declineRoleUpgrade(...a),
}));

// Granting an upgrade goes through the callable, never a client write: a role
// lives in four fields that must move together, and firestore.rules refuses all
// four from a browser.
const managerSetUserRole = vi.fn().mockResolvedValue({ success: true, changed: true });
vi.mock('../../src/utils/cloudFunctions', () => ({
    managerSetUserRole: (...a: unknown[]) => managerSetUserRole(...a),
    createManagerInvite: vi.fn(),
}));

// Approving now writes an audit row, so the component needs to know WHO is doing it.
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: 'mgr_1' },
        userProfile: { name: 'Mira' },
    }),
}));

/** The actor every call must carry — an audit row that cannot name one is useless. */
const ACTOR = { uid: 'mgr_1', name: 'Mira' };

import { ManagerPeople } from '../../components/manager/ManagerPeople';
import { ToastProvider } from '../../contexts/ToastContext';

const show = () => render(<ToastProvider><ManagerPeople /></ToastProvider>);

const aDriver = { id: 'drv1', name: 'Ramesh Patel', phone: '+15550001111', carModel: 'Odyssey' };
const aRider = { id: 'rdr1', name: 'Anita Shah', phone: '+15550002222', address: '12 Maple Ave' };

const aHopeful = {
    id: 'hop1', name: 'Priya Desai', phone: '+15550003333',
    roleUpgrade: { status: 'pending', requestedAt: '2026-08-24T09:00:00.000Z' },
};

beforeEach(() => {
    usePendingDrivers.mockReturnValue({ pendingDrivers: [aDriver], loading: false });
    usePendingRiders.mockReturnValue({ pendingRiders: [aRider], loading: false });
    useRoleUpgradeRequests.mockReturnValue({ requests: [], loading: false });
    managerSetUserRole.mockResolvedValue({ success: true, changed: true });
});

describe('ManagerPeople — the queue', () => {
    it('separates drivers from riders', () => {
        show();
        expect(screen.getByText(/Sarthis · 1/)).toBeInTheDocument();
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

        await waitFor(() => expect(updateUserStatus).toHaveBeenCalledWith('drv1', 'approved', ACTOR));
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

        await waitFor(() => expect(updateUserStatus).toHaveBeenCalledWith('drv1', 'rejected', ACTOR));
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


/**
 * The third queue: Bhulka already in the app asking to drive.
 *
 * A different decision from the two above. Those answer "may this person use the
 * app at all"; this one answers "may they be given a car full of children", about
 * somebody who is already inside.
 */
describe('ManagerPeople — requests to become a Sarthi', () => {
    it('does not render the section when nobody has asked', () => {
        show();
        expect(screen.queryByText(/Wants to drive/)).not.toBeInTheDocument();
    });

    it('lists whoever has asked, and counts them in the total', () => {
        useRoleUpgradeRequests.mockReturnValue({ requests: [aHopeful], loading: false });
        show();

        expect(screen.getByText(/Wants to drive · 1/)).toBeInTheDocument();
        expect(screen.getByText('Priya Desai')).toBeInTheDocument();
        expect(screen.getByText('Asked to become a Sarthi')).toBeInTheDocument();
        // One driver, one rider, one hopeful.
        expect(screen.getByText('3 waiting to be approved.')).toBeInTheDocument();
    });

    it('says what the button does, rather than "Approve"', () => {
        // Approving a sign-up and handing somebody a carload of children are not
        // the same act, and the control should not read as though they were.
        useRoleUpgradeRequests.mockReturnValue({ requests: [aHopeful], loading: false });
        show();

        expect(screen.getByRole('button', { name: /Make Sarthi/ })).toBeInTheDocument();
    });

    it('grants it through the callable, not a client write', async () => {
        useRoleUpgradeRequests.mockReturnValue({ requests: [aHopeful], loading: false });
        show();

        await userEvent.click(screen.getByRole('button', { name: /Make Sarthi/ }));

        await waitFor(() => {
            expect(managerSetUserRole).toHaveBeenCalledWith('hop1', 'driver');
        });
        expect(declineRoleUpgrade).not.toHaveBeenCalled();
    });

    it('asks before turning somebody down', async () => {
        useRoleUpgradeRequests.mockReturnValue({ requests: [aHopeful], loading: false });
        show();

        const section = screen.getByText(/Wants to drive · 1/).closest('section')!;
        await userEvent.click(within(section).getByRole('button', { name: /Turn down/ }));

        // The confirm, not the write.
        expect(await screen.findByText(/Turn down Priya Desai\?/)).toBeInTheDocument();
        expect(declineRoleUpgrade).not.toHaveBeenCalled();
    });

    it('records the decline against the manager who made it', async () => {
        useRoleUpgradeRequests.mockReturnValue({ requests: [aHopeful], loading: false });
        show();

        const section = screen.getByText(/Wants to drive · 1/).closest('section')!;
        await userEvent.click(within(section).getByRole('button', { name: /Turn down/ }));

        // Scoped to the dialog: the row's own deny button carries the same label,
        // so an unscoped query matches two and picks the wrong one.
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /Turn down/ }));

        await waitFor(() => {
            expect(declineRoleUpgrade).toHaveBeenCalledWith(
                'hop1', '2026-08-24T09:00:00.000Z', ACTOR,
            );
        });
    });

    it('shows the server\'s own words when the change is refused', async () => {
        // "Nilesh is out on a run with 2 rides — Asha, Ravi" is something a manager
        // can act on. "Could not update" is not.
        useRoleUpgradeRequests.mockReturnValue({ requests: [aHopeful], loading: false });
        managerSetUserRole.mockRejectedValue(new Error('They are on a ride right now.'));
        show();

        await userEvent.click(screen.getByRole('button', { name: /Make Sarthi/ }));

        expect(await screen.findByText('They are on a ride right now.')).toBeInTheDocument();
    });
});
