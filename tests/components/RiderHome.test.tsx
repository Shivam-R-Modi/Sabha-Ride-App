/**
 * The rider's home screen.
 *
 * The point of Phase 3 is that this screen shows ONE card with AT MOST ONE
 * primary action. The old one stacked up to five cards and two competing
 * primary buttons, and hijacked the whole dashboard twice over to ask a yes/no
 * question. So the load-bearing assertion here is a count, not an appearance.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWeeklyAttendance = vi.fn().mockResolvedValue(undefined);
const updateAttendanceResponse = vi.fn().mockResolvedValue({ success: true });
const studentReadyToLeave = vi.fn().mockResolvedValue(undefined);
const useCurrentEvent = vi.fn();

vi.mock('../../hooks/useFirestore', () => ({
    submitWeeklyAttendance: (...a: unknown[]) => submitWeeklyAttendance(...a),
    updateAttendanceResponse: (...a: unknown[]) => updateAttendanceResponse(...a),
}));
vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => useCurrentEvent() }));
vi.mock('../../src/utils/cloudFunctions', () => ({
    studentReadyToLeave: (...a: unknown[]) => studentReadyToLeave(...a),
}));
// The booking form has its own 20 tests; here it only needs to be openable.
vi.mock('../../components/PickupForm', () => ({
    PickupForm: () => <div>pickup form contents</div>,
}));

import { RiderHome } from '../../components/student/RiderHome';
import { ToastProvider } from '../../contexts/ToastContext';
import type { RiderState } from '../../src/utils/riderState';

const rider = {
    id: 'rider-1', name: 'Meera Patel', address: '42 Oak Street',
    phone: '+15550001111', role: 'student',
} as never;

const driverRide = {
    id: 'r1', status: 'assigned', pickupAddress: '42 Oak Street', timeSlot: '6:45 PM',
    date: '2026-08-14',
    driver: {
        id: 'd1', name: 'Ramesh Patel', phone: '+15550002222',
        avatarUrl: 'x', carModel: 'Odyssey', carColor: 'Silver', plateNumber: 'NJ-1',
    },
} as never;

const show = (state: RiderState, ride: unknown = null) =>
    render(
        <ToastProvider>
            <RiderHome
                user={rider}
                state={state}
                ride={ride as never}
                onAttendanceAnswered={vi.fn()}
            />
        </ToastProvider>,
    );

/**
 * Primary actions on screen. Excludes the greeting, links, and the dialog
 * furniture a Sheet brings with it.
 */
const primaryActions = () =>
    screen.queryAllByRole('button').filter(b => {
        const label = b.textContent?.trim() ?? '';
        return label.length > 0 && !/^(Close|Dismiss)$/.test(label);
    });

beforeEach(() => {
    useCurrentEvent.mockReturnValue({ eventId: '2026-08-14', hasEvent: true, canWithdraw: true });
});

describe('RiderHome — one card, one action', () => {
    const oneActionStates: [string, RiderState][] = [
        ['can-request', { kind: 'can-request' }],
        ['not-coming', { kind: 'not-coming' }],
        ['ready-to-leave', { kind: 'ready-to-leave' }],
    ];

    it.each(oneActionStates)('%s offers exactly one action', (_name, state) => {
        show(state);
        expect(primaryActions()).toHaveLength(1);
    });

    const noActionStates: [string, RiderState][] = [
        ['loading', { kind: 'loading' }],
        ['no-sabha', { kind: 'no-sabha' }],
        ['waiting-for-driver', { kind: 'waiting-for-driver' }],
        ['in-dropoff-queue', { kind: 'in-dropoff-queue' }],
    ];

    it.each(noActionStates)('%s offers no action at all, rather than a dead one', (_n, state) => {
        show(state);
        expect(primaryActions()).toHaveLength(0);
    });

    it('the attendance question is the one card with two, because it is a choice', () => {
        show({ kind: 'attendance-unanswered' });
        expect(primaryActions()).toHaveLength(2);
    });

    it('never shows the go-home button while the window is shut', () => {
        // The old screen kept it on screen roughly six days out of seven,
        // greyed out under a blur veil. Now it simply is not rendered.
        show({ kind: 'can-request' });
        expect(screen.queryByRole('button', { name: /ready to leave/i })).not.toBeInTheDocument();
    });

    it('never shows the request button while waiting to go home', () => {
        show({ kind: 'ready-to-leave' });
        expect(screen.queryByRole('button', { name: /request a ride/i })).not.toBeInTheDocument();
    });
});

describe('RiderHome — what each state says', () => {
    it('greets the rider by name', () => {
        show({ kind: 'can-request' });
        expect(screen.getByText('Meera Patel')).toBeInTheDocument();
    });

    it('explains an empty calendar rather than looking broken', () => {
        show({ kind: 'no-sabha' });
        expect(screen.getByText(/No sabha scheduled yet/i)).toBeInTheDocument();
    });

    it('shows a skeleton while loading, marked as busy', () => {
        show({ kind: 'loading' });
        expect(screen.getByLabelText(/loading your ride/i)).toHaveAttribute('aria-busy', 'true');
    });

    it('reassures a rider who is waiting', () => {
        show({ kind: 'waiting-for-driver' });
        expect(screen.getByText(/Looking for a driver/i)).toBeInTheDocument();
    });

    it('shows the driver once one is assigned', () => {
        show({ kind: 'driver-assigned', split: null }, driverRide);
        expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
    });

    it('confirms a rider is in the queue home', () => {
        show({ kind: 'in-dropoff-queue' });
        expect(screen.getByText(/in the queue/i)).toBeInTheDocument();
    });
});

describe('RiderHome — a family split across two cars', () => {
    const split = { totalSeats: 5, assignedSeats: 3, waitingSeats: 2, driverName: 'Ramesh' };

    it('says how many are away and how many are still waiting', () => {
        show({ kind: 'driver-assigned', split }, driverRide);
        expect(screen.getByText(/3 of your 5 seats/)).toBeInTheDocument();
        expect(screen.getByText(/other 2 are still waiting/i)).toBeInTheDocument();
    });

    it('says nothing about a split when there is not one', () => {
        show({ kind: 'driver-assigned', split: null }, driverRide);
        expect(screen.queryByText(/still waiting for the next car/i)).not.toBeInTheDocument();
    });
});

describe('RiderHome — a dismissed request', () => {
    const info = {
        managerName: 'Ramesh', managerContact: '+15550009999',
        dismissedAt: '2026-08-12T18:00:00.000Z',
    };

    it('names who turned it down', () => {
        show({ kind: 'dismissed', info });
        expect(screen.getByText(/Ramesh could not fit you in/i)).toBeInTheDocument();
    });

    it('offers a way to reach them', () => {
        const { container } = show({ kind: 'dismissed', info });
        expect(container.querySelector('a[href="tel:+15550009999"]')).toBeTruthy();
    });

    it('offers no phone link when there is no number, rather than a dead one', () => {
        const { container } = show({ kind: 'dismissed', info: { managerName: 'Ramesh' } });
        expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    });
});

describe('RiderHome — attendance is a card, not a hostage situation', () => {
    it('asks inline, leaving the rest of the screen in place', () => {
        show({ kind: 'attendance-unanswered' });
        // The greeting is still there — the question has not replaced the app.
        expect(screen.getByText('Jai Swaminarayan!')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Yes, I'm coming/i })).toBeInTheDocument();
    });

    it('records a yes', async () => {
        const user = userEvent.setup();
        show({ kind: 'attendance-unanswered' });

        await user.click(screen.getByRole('button', { name: /Yes, I'm coming/i }));

        await waitFor(() => expect(submitWeeklyAttendance).toHaveBeenCalledWith(
            'rider-1', 'yes', expect.objectContaining({ name: 'Meera Patel' }), '2026-08-14',
        ));
    });

    it('goes straight into booking after a yes, because that is what yes means next', async () => {
        const user = userEvent.setup();
        show({ kind: 'attendance-unanswered' });

        await user.click(screen.getByRole('button', { name: /Yes, I'm coming/i }));

        expect(await screen.findByRole('dialog', { name: /request a ride/i })).toBeInTheDocument();
    });

    it('records a no without opening anything', async () => {
        const user = userEvent.setup();
        show({ kind: 'attendance-unanswered' });

        await user.click(screen.getByRole('button', { name: /Not this time/i }));

        await waitFor(() => expect(submitWeeklyAttendance).toHaveBeenCalledWith(
            'rider-1', 'no', expect.anything(), '2026-08-14',
        ));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('reports a failure instead of pretending it saved', async () => {
        const user = userEvent.setup();
        submitWeeklyAttendance.mockRejectedValueOnce(new Error('Responses are locked.'));
        show({ kind: 'attendance-unanswered' });

        await user.click(screen.getByRole('button', { name: /Yes, I'm coming/i }));

        expect(await screen.findByText('Responses are locked.')).toBeInTheDocument();
    });

    it('lets someone who said no change their mind', async () => {
        const user = userEvent.setup();
        show({ kind: 'not-coming' });

        await user.click(screen.getByRole('button', { name: /Actually, I'm coming/i }));

        await waitFor(() => expect(updateAttendanceResponse)
            .toHaveBeenCalledWith('rider-1', 'yes', 'no', '2026-08-14', true));
    });

    it('surfaces the reason when changing back is refused', async () => {
        const user = userEvent.setup();
        updateAttendanceResponse.mockResolvedValueOnce({ success: false, error: 'Responses are locked.' });
        show({ kind: 'not-coming' });

        await user.click(screen.getByRole('button', { name: /Actually, I'm coming/i }));

        expect(await screen.findByText('Responses are locked.')).toBeInTheDocument();
    });
});

describe('RiderHome — booking', () => {
    it('opens the form in a sheet, so home stays behind it', async () => {
        const user = userEvent.setup();
        show({ kind: 'can-request' });

        await user.click(screen.getByRole('button', { name: /request a ride/i }));

        const dialog = await screen.findByRole('dialog', { name: /request a ride/i });
        expect(within(dialog).getByText('pickup form contents')).toBeInTheDocument();
        expect(screen.getByText('Jai Swaminarayan!')).toBeInTheDocument();
    });

    it('closes on Escape', async () => {
        const user = userEvent.setup();
        show({ kind: 'can-request' });
        await user.click(screen.getByRole('button', { name: /request a ride/i }));
        await screen.findByRole('dialog');

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});

describe('RiderHome — going home', () => {
    it('asks before telling the driver', async () => {
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));

        expect(await screen.findByRole('dialog', { name: /Ready for pickup/i })).toBeInTheDocument();
        expect(studentReadyToLeave).not.toHaveBeenCalled();
    });

    it('tells the driver once confirmed', async () => {
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, tell them/i }));

        await waitFor(() => expect(studentReadyToLeave).toHaveBeenCalledWith('rider-1'));
    });

    it('does nothing if the rider backs out', async () => {
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Not yet/i }));

        expect(studentReadyToLeave).not.toHaveBeenCalled();
    });

    it('reports a failure rather than leaving the rider thinking help is coming', async () => {
        const user = userEvent.setup();
        studentReadyToLeave.mockRejectedValueOnce(new Error('nope'));
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, tell them/i }));

        expect(await screen.findByText(/Could not let your driver know/i)).toBeInTheDocument();
    });
});
