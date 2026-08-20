/**
 * The rider's home screen.
 *
 * The point of Phase 3 is that this screen shows ONE card with AT MOST ONE
 * primary action. The old one stacked up to five cards and two competing
 * primary buttons, and hijacked the whole dashboard twice over to ask a yes/no
 * question. So the load-bearing assertion here is a count, not an appearance.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWeeklyAttendance = vi.fn().mockResolvedValue(undefined);
const updateAttendanceResponse = vi.fn().mockResolvedValue({ success: true });
const studentReadyToLeave = vi.fn().mockResolvedValue(undefined);
const useCurrentEvent = vi.fn();
const useSettings = vi.fn();

// RiderHome now renders PushPrompt, which needs a uid and so reads useAuth.
// Same pattern as Layout.test.tsx: mock the context rather than wrapping every
// test in a provider. The prompt itself renders null here — jsdom has no
// Notification API, so push reports as unsupported.
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: 'rider_1' },
        userProfile: { id: 'rider_1', name: 'Asha' },
        refreshProfile: vi.fn(),
    }),
}));

vi.mock('../../hooks/useFirestore', () => ({
    submitWeeklyAttendance: (...a: unknown[]) => submitWeeklyAttendance(...a),
    updateAttendanceResponse: (...a: unknown[]) => updateAttendanceResponse(...a),
}));
vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => useCurrentEvent() }));
vi.mock('../../hooks/useSettings', () => ({ useSettings: () => useSettings() }));
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

/** 360 Huntington Ave — the founding venue. */
const VENUE = { lat: 42.339925, lng: -71.088182 };

const driverRide = {
    id: 'r1', status: 'assigned', pickupAddress: '42 Oak Street', timeSlot: '6:45 PM',
    date: '2026-08-14',
    driver: {
        id: 'd1', name: 'Ramesh Patel', phone: '+15550002222',
        avatarUrl: 'x', carModel: 'Odyssey', carColor: 'Silver', plateNumber: 'NJ-1',
    },
} as never;

const show = (
    state: RiderState,
    ride: unknown = null,
    userOverride: object = {},
    onWithdraw?: () => Promise<void>,
) =>
    render(
        <ToastProvider>
            <RiderHome
                user={{ ...(rider as object), ...userOverride } as never}
                state={state}
                ride={ride as never}
                onAttendanceAnswered={vi.fn()}
                onWithdraw={onWithdraw}
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
    useCurrentEvent.mockReturnValue({
        eventId: '2026-08-14', hasEvent: true, canWithdraw: true, venue: VENUE,
    });
    useSettings.mockReturnValue({ sabhaLocation: VENUE });
    delete (navigator as any).geolocation;
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
        // Driving tonight: no lift to ask for, and the card says why rather than
        // showing a greyed-out button that cannot explain itself.
        ['driving-tonight', { kind: 'driving-tonight' }],
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

/**
 * Going home no longer depends on how the rider got here.
 *
 * `studentReadyToLeave` used to refuse anyone whose status was not `at_sabha`,
 * and that flag is only ever written when a home→sabha ride completes — so a
 * rider who walked, drove, or got a lift from a friend was locked out for good
 * while still being shown the button.
 *
 * Presence is now established on the way in: a completed pickup short-circuits
 * it, a GPS fix inside 100m confirms it, and otherwise the rider is simply
 * asked. jsdom has no geolocation, so every case here takes that third route —
 * which is also the ordinary real-world path for anyone stood indoors.
 */
describe('RiderHome — going home', () => {
    it('asks whether they are at the sabha before telling anyone', async () => {
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));

        expect(await screen.findByRole('dialog', { name: /Are you at the sabha/i })).toBeInTheDocument();
        expect(studentReadyToLeave).not.toHaveBeenCalled();
    });

    it('joins the queue once the rider confirms, recording how', async () => {
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, I am here/i }));

        await waitFor(() => expect(studentReadyToLeave)
            .toHaveBeenCalledWith('rider-1', { method: 'manual' }));
    });

    it('never sends coordinates', async () => {
        // Precise location for a child is data this app should not hold, and the
        // manual route means the verdict was never enforceable anyway.
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, I am here/i }));

        await waitFor(() => expect(studentReadyToLeave).toHaveBeenCalled());
        const claim: any = studentReadyToLeave.mock.calls[0]![1];
        expect(claim.lat).toBeUndefined();
        expect(claim.lng).toBeUndefined();
    });

    it('does nothing if the rider backs out', async () => {
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Not yet/i }));

        expect(studentReadyToLeave).not.toHaveBeenCalled();
    });

    it('shows the server\'s OWN reason, not a generic retry prompt', async () => {
        // This used to be a flat "Could not let your driver know. Please try
        // again." for every failure, which threw away the one thing the rider
        // needed and advised the single action that could never help.
        const user = userEvent.setup();
        studentReadyToLeave.mockRejectedValueOnce(
            new Error('Your home address is not set. Please update your address in Profile.'));
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, I am here/i }));

        expect(await screen.findByText(/home address is not set/i)).toBeInTheDocument();
    });

    it('still says something when the failure carries no message', async () => {
        const user = userEvent.setup();
        studentReadyToLeave.mockRejectedValueOnce(new Error(''));
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, I am here/i }));

        expect(await screen.findByText(/Could not let your driver know/i)).toBeInTheDocument();
    });
});

/**
 * The two routes that spare the rider a question.
 *
 * Both matter because the manual prompt is the fallback, not the goal: someone
 * whose pickup just completed should not be interrogated about whether they are
 * where the app drove them.
 */
describe('RiderHome — establishing presence without asking', () => {
    /** Stub the browser's geolocation with a fixed reading. */
    const withFix = (coords: { latitude: number; longitude: number; accuracy: number }) => {
        (navigator as any).geolocation = {
            getCurrentPosition: (ok: PositionCallback) =>
                ok({ coords } as GeolocationPosition),
        };
    };

    it('skips the question entirely for a rider whose pickup completed', async () => {
        // They are here by definition — the app drove them.
        const user = userEvent.setup();
        show({ kind: 'ready-to-leave' }, null, { status: 'at_sabha' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));

        expect(await screen.findByRole('dialog', { name: /Ready for pickup/i })).toBeInTheDocument();
        expect(screen.queryByText(/Are you at the sabha/i)).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Yes, tell them/i }));
        await waitFor(() => expect(studentReadyToLeave)
            .toHaveBeenCalledWith('rider-1', { method: 'pickup' }));
    });

    it('confirms automatically from a sharp fix at the venue', async () => {
        const user = userEvent.setup();
        withFix({ latitude: VENUE.lat, longitude: VENUE.lng, accuracy: 8 });
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, tell them/i }));

        await waitFor(() => expect(studentReadyToLeave)
            .toHaveBeenCalledWith('rider-1', { method: 'auto', distanceMeters: 0 }));
    });

    it('asks anyway when the fix is too vague to judge', async () => {
        // The ordinary indoor case: a phone under a roof falls back to Wi-Fi
        // positioning. Treating that as a pass would let someone at home
        // through; treating it as a fail would strand someone in the hall.
        const user = userEvent.setup();
        withFix({ latitude: VENUE.lat, longitude: VENUE.lng, accuracy: 400 });
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));

        expect(await screen.findByRole('dialog', { name: /Are you at the sabha/i })).toBeInTheDocument();
    });

    it('ASKS rather than blocks when GPS is confident they are far away', async () => {
        // The decision the whole design turns on. Being stranded at the temple
        // is worse than a driver making one wasted stop, so nobody is ever
        // refused — but what GPS thought is recorded for the manager.
        const user = userEvent.setup();
        withFix({ latitude: 42.4, longitude: -71.2, accuracy: 8 });
        show({ kind: 'ready-to-leave' });

        await user.click(screen.getByRole('button', { name: /ready to leave/i }));
        await user.click(await screen.findByRole('button', { name: /Yes, I am here/i }));

        await waitFor(() => expect(studentReadyToLeave).toHaveBeenCalled());
        const claim: any = studentReadyToLeave.mock.calls[0]![1];
        expect(claim.method).toBe('manual');
        expect(claim.distanceMeters).toBeGreaterThan(1000);
    });
});

describe('RiderHome — driving tonight', () => {
    /**
     * The Sarthi wearing the Bhulku hat. The role hierarchy grants that hat on
     * purpose; this is the screen that stops it being used to book a lift while
     * holding a car, which dispatch would otherwise answer by assigning them their
     * own request.
     */
    it('says they are driving instead of offering a ride', () => {
        show({ kind: 'driving-tonight' });
        expect(screen.getByText('You are driving tonight')).toBeInTheDocument();
    });

    it('offers no Request a ride button', () => {
        show({ kind: 'driving-tonight' });
        expect(screen.queryByRole('button', { name: /request a ride/i })).toBeNull();
    });

    it('says how to change it, so it is not a dead end', () => {
        // A screen that removes the only action has to point somewhere.
        show({ kind: 'driving-tonight' });
        expect(screen.getByText(/hand the car back/i)).toBeInTheDocument();
    });
});

describe('RiderHome — taking a request back', () => {
    /**
     * The owner asked for this: "after request if bhulku decides not to go then he
     * take that request back". firestore.rules had always permitted a rider to
     * write `cancelled` — no control was ever built, so the capability sat unused.
     *
     * The boundary that matters is WHEN. Offered only while nobody has taken the
     * ride; once a Sarthi is assigned they are on their way and the seat is
     * accounted for, so the rules refuse it and the control is not rendered. A
     * button that would be refused is worse than no button.
     */
    it('offers no withdraw when the caller does not supply one', () => {
        // 'driver-assigned' passes no onWithdraw, so nothing to press.
        show({ kind: 'waiting-for-driver' });
        expect(screen.queryByRole('button', { name: /no longer need a ride/i })).toBeNull();
    });

    it('offers it while still waiting', () => {
        show({ kind: 'waiting-for-driver' }, null, {}, vi.fn());
        expect(screen.getByRole('button', { name: /no longer need a ride/i })).toBeInTheDocument();
    });

    it('asks before cancelling, and cancels on yes', async () => {
        const onWithdraw = vi.fn(async () => undefined);
        show({ kind: 'waiting-for-driver' }, null, {}, onWithdraw);

        fireEvent.click(screen.getByRole('button', { name: /no longer need a ride/i }));

        // useConfirm renders a dialog; window.confirm is banned in this repo.
        const yes = await screen.findByRole('button', { name: /yes, cancel it/i });
        fireEvent.click(yes);

        await waitFor(() => expect(onWithdraw).toHaveBeenCalledTimes(1));
    });

    it('does nothing if they change their mind about changing their mind', async () => {
        const onWithdraw = vi.fn(async () => undefined);
        show({ kind: 'waiting-for-driver' }, null, {}, onWithdraw);

        fireEvent.click(screen.getByRole('button', { name: /no longer need a ride/i }));
        fireEvent.click(await screen.findByRole('button', { name: /keep it/i }));

        await waitFor(() => expect(onWithdraw).not.toHaveBeenCalled());
    });

    it('surfaces the reason when the write is refused', async () => {
        // A silent failure here would leave a rider believing they had cancelled.
        const onWithdraw = vi.fn(async () => { throw new Error('Missing or insufficient permissions.'); });
        show({ kind: 'waiting-for-driver' }, null, {}, onWithdraw);

        fireEvent.click(screen.getByRole('button', { name: /no longer need a ride/i }));
        fireEvent.click(await screen.findByRole('button', { name: /yes, cancel it/i }));

        expect(await screen.findByText(/insufficient permissions/i)).toBeInTheDocument();
    });
});
