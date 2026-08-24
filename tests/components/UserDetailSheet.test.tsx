/**
 * One person's record, and the two buttons that change what they are.
 *
 * Two things here are load-bearing beyond appearance.
 *
 * The role is read through `recordedRoles()`, not `user.role`. A role lives in
 * four fields and the raw editor beside this dialog could always write them one
 * at a time, so documents exist where `role: 'driver'` sits next to
 * `roles: ['student']`. Rendering `role` alone shows that as a tidy single answer
 * and hides the inconsistency a manager opened the dialog to fix.
 *
 * And a manager target gets NO control rather than a disabled one. Removing the
 * manager role also has to clear a custom claim, which this path does not do — so
 * the button must not exist, not merely be greyed out.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const managerSetUserRole = vi.fn();
vi.mock('../../src/utils/cloudFunctions', () => ({
    managerSetUserRole: (...a: unknown[]) => managerSetUserRole(...a),
}));

import { UserDetailSheet } from '../../components/manager/UserDetailSheet';
import { ToastProvider } from '../../contexts/ToastContext';

const BHULKU = {
    id: 'p1', name: 'Asha Mehta', email: 'asha@example.com', phone: '+15550001111',
    address: '12 Maple Ave', accountStatus: 'approved', createdAt: '2026-01-05T00:00:00.000Z',
    role: 'student', registeredRole: 'student', roles: ['student'], activeRole: 'student',
};

const SARTHI = {
    id: 'p2', name: 'Nilesh Rao', email: 'nilesh@example.com', phone: '+15550002222',
    accountStatus: 'approved',
    role: 'driver', registeredRole: 'driver', roles: ['driver', 'student'], activeRole: 'driver',
    currentVehicleId: 'veh_1', currentVehicleName: 'Silver Odyssey', status: 'available',
};

const MANAGER = {
    id: 'p3', name: 'Mira Shah', accountStatus: 'approved',
    role: 'manager', registeredRole: 'manager',
    roles: ['manager', 'driver', 'student'], activeRole: 'manager',
};

const show = (user: any, onClose = vi.fn(), activeRideCount = 0) => {
    render(
        <ToastProvider>
            <UserDetailSheet user={user} onClose={onClose} activeRideCount={activeRideCount} />
        </ToastProvider>,
    );
    return onClose;
};

/** Click through the confirm prompt that guards every change. */
const confirmWith = async (label: RegExp) => {
    const dialogs = await screen.findAllByRole('dialog');
    const prompt = dialogs[dialogs.length - 1]!;
    await userEvent.click(within(prompt).getByRole('button', { name: label }));
};

beforeEach(() => {
    managerSetUserRole.mockResolvedValue({ success: true, changed: true, role: 'driver' });
});

describe('UserDetailSheet — renders nothing without a person', () => {
    it('is absent when no user is selected', () => {
        show(null);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('UserDetailSheet — what it shows', () => {
    it('names the person as the dialog title', () => {
        show(BHULKU);
        expect(screen.getByRole('dialog', { name: /Asha Mehta/ })).toBeInTheDocument();
    });

    it('keeps that accessible name even though the heading is not drawn', () => {
        // The heading is `sr-only`: the name was being shown TWICE, once as the
        // Sheet's title and once beside the avatar. Hiding it visually is right;
        // DELETING it would leave a role="dialog" with no accessible name, which a
        // screen reader announces as bare "dialog" and which nobody else can see is
        // broken. This is the test that fails if somebody removes the title instead
        // of hiding it.
        show(BHULKU);

        const dialog = screen.getByRole('dialog');
        const labelledBy = dialog.getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        expect(document.getElementById(labelledBy!)?.textContent).toBe('Asha Mehta');
    });

    it('shows the contact details the table no longer displays', () => {
        // They moved OFF the table and in here on purpose. If they are not here,
        // the narrowing lost information rather than relocating it.
        show(BHULKU);

        expect(screen.getByText('asha@example.com')).toBeInTheDocument();
        expect(screen.getByText('+15550001111')).toBeInTheDocument();
        expect(screen.getByText('12 Maple Ave')).toBeInTheDocument();
    });

    it('shows the role in words a manager uses', () => {
        show(BHULKU);
        expect(screen.getAllByText('Bhulku').length).toBeGreaterThan(0);
    });

    it('shows a Sarthi the car they are holding', () => {
        show(SARTHI);
        expect(screen.getByText(/Silver Odyssey/)).toBeInTheDocument();
    });

    it('says when somebody has asked to drive', () => {
        show({ ...BHULKU, roleUpgrade: { status: 'pending', requestedAt: 'x' } });
        expect(screen.getByText(/asked to become a Sarthi/i)).toBeInTheDocument();
    });
});

describe('UserDetailSheet — the four role fields are read as one', () => {
    it('flags a record that disagrees with itself', () => {
        // The exact shape the raw field editor could produce: driver by `role`,
        // Bhulku by `roles`. Silence here would hide the bug this whole feature
        // exists to end.
        show({ ...BHULKU, role: 'driver' });

        expect(screen.getByText(/disagrees with itself/i)).toBeInTheDocument();
    });

    it('does not flag a healthy record', () => {
        show(SARTHI);
        expect(screen.queryByText(/disagrees with itself/i)).not.toBeInTheDocument();
    });

    it('offers BOTH directions for a record that disagrees with itself', async () => {
        // Its current role is not a fact, so offering only the opposite of a guess
        // would make the manager demote and re-promote to land on the answer they
        // wanted. Either button rewrites all four fields, so either one repairs it.
        show({ ...BHULKU, role: 'driver' });

        expect(screen.getByRole('button', { name: /Make Sarthi/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Return to Bhulku/ })).toBeInTheDocument();
    });

    it('repairs a mixed record in one tap, in whichever direction was chosen', async () => {
        show({ ...BHULKU, role: 'driver' });

        await userEvent.click(screen.getByRole('button', { name: /Make Sarthi/ }));
        await confirmWith(/Make Sarthi/);

        await waitFor(() => expect(managerSetUserRole).toHaveBeenCalledWith('p1', 'driver'));
    });

    it('does not flag a manager, whose roles legitimately nest', () => {
        // manager implies driver implies student. Three recorded roles is correct
        // there, and calling it a fault would train managers to ignore the warning.
        show(MANAGER);
        expect(screen.queryByText(/disagrees with itself/i)).not.toBeInTheDocument();
    });
});

describe('UserDetailSheet — promoting', () => {
    it('offers a Bhulku the way up, and not the way down', () => {
        show(BHULKU);

        expect(screen.getByRole('button', { name: /Make Sarthi/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Return to Bhulku/ })).not.toBeInTheDocument();
    });

    it('asks first, and does not call the server until confirmed', async () => {
        show(BHULKU);
        await userEvent.click(screen.getByRole('button', { name: /Make Sarthi/ }));

        expect(await screen.findByText(/Make Asha Mehta a Sarthi\?/)).toBeInTheDocument();
        expect(managerSetUserRole).not.toHaveBeenCalled();
    });

    it('calls the callable with the person and the role', async () => {
        show(BHULKU);
        await userEvent.click(screen.getByRole('button', { name: /Make Sarthi/ }));
        await confirmWith(/Make Sarthi/);

        await waitFor(() => expect(managerSetUserRole).toHaveBeenCalledWith('p1', 'driver'));
    });

    it('closes once it has worked', async () => {
        const onClose = show(BHULKU);
        await userEvent.click(screen.getByRole('button', { name: /Make Sarthi/ }));
        await confirmWith(/Make Sarthi/);

        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});

describe('UserDetailSheet — demoting', () => {
    it('offers a Sarthi the way down, and not the way up', () => {
        show(SARTHI);

        expect(screen.getByRole('button', { name: /Return to Bhulku/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Make Sarthi/ })).not.toBeInTheDocument();
    });

    it('spells out the car and the riders before asking', async () => {
        // The manager is looking at a table of names and cannot see either. A
        // confirm that only says "are you sure" makes them find out by trying.
        show(SARTHI, vi.fn(), 2);
        await userEvent.click(screen.getByRole('button', { name: /Return to Bhulku/ }));

        expect(await screen.findByText(/car they are holding goes back/i)).toBeInTheDocument();
        expect(screen.getByText(/2 ride\(s\) already assigned/i)).toBeInTheDocument();
    });

    it('warns that a run already under way will be refused', async () => {
        show(SARTHI);
        await userEvent.click(screen.getByRole('button', { name: /Return to Bhulku/ }));

        expect(await screen.findByText(/already under way this will be refused/i))
            .toBeInTheDocument();
    });

    it('sends student, not driver', async () => {
        show(SARTHI);
        await userEvent.click(screen.getByRole('button', { name: /Return to Bhulku/ }));
        await confirmWith(/Return to Bhulku/);

        await waitFor(() => expect(managerSetUserRole).toHaveBeenCalledWith('p2', 'student'));
    });
});

describe('UserDetailSheet — a manager is refused, visibly', () => {
    it('offers neither control', () => {
        show(MANAGER);

        expect(screen.queryByRole('button', { name: /Make Sarthi/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Return to Bhulku/ })).not.toBeInTheDocument();
    });

    it('says why, and where the change is made instead', () => {
        show(MANAGER);
        expect(screen.getByText(/single-use invites/i)).toBeInTheDocument();
    });
});

describe('UserDetailSheet — failure is never silent', () => {
    it('shows the server\'s own refusal', async () => {
        // "Nilesh is out on a run with 2 rides — Asha, Ravi" is actionable.
        // "Could not update" sends the manager looking for a fault in dispatch.
        managerSetUserRole.mockRejectedValue(
            new Error('Nilesh Rao is out on a run with 2 ride(s) — Asha, Ravi.'),
        );
        show(SARTHI);

        await userEvent.click(screen.getByRole('button', { name: /Return to Bhulku/ }));
        await confirmWith(/Return to Bhulku/);

        expect(await screen.findByText(/out on a run with 2 ride\(s\) — Asha, Ravi\./))
            .toBeInTheDocument();
    });

    it('stays open after a refusal, so the manager can see the record again', async () => {
        managerSetUserRole.mockRejectedValue(new Error('nope'));
        const onClose = show(SARTHI);

        await userEvent.click(screen.getByRole('button', { name: /Return to Bhulku/ }));
        await confirmWith(/Return to Bhulku/);

        await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument());
        expect(onClose).not.toHaveBeenCalled();
    });

    it('reports an unchanged document as unchanged, not as a success', async () => {
        // The callable is idempotent by design. Saying "done" when nothing happened
        // is how a manager concludes a broken record was fixed.
        managerSetUserRole.mockResolvedValue({ success: true, changed: false, reason: 'already' });
        show(BHULKU);

        await userEvent.click(screen.getByRole('button', { name: /Make Sarthi/ }));
        await confirmWith(/Make Sarthi/);

        expect(await screen.findByText(/already a Sarthi/i)).toBeInTheDocument();
    });
});
