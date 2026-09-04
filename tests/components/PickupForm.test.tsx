/**
 * The rider's Request Pickup screen.
 *
 * STATUS.md records this as one of two surfaces "never seen rendered" — covered
 * by logic tests and confirmed present in the live bundle, but nobody has ever
 * looked at it in a browser, because reaching it needs a sign-in. So these are
 * the first assertions that the screen actually draws, and the first guard on
 * the seat stepper and "Keep us in one car" that Phase 3 part 1 shipped.
 *
 * Everything here asserts text, roles and the payload handed to
 * createRideRequest. Nothing asserts a class name, so the restyle cannot break
 * these — which is the entire point of writing them before it starts.
 */

import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createRideRequest = vi.fn().mockResolvedValue(undefined);
const useCurrentEvent = vi.fn();
const useSettings = vi.fn();

/**
 * ONE HALL BY DEFAULT, which is production and the configuration every case in this
 * file was written against. Stated rather than left to an unmocked hook so the
 * single-hall behaviour is asserted rather than incidental.
 */
const HUNTINGTON = {
    id: 'boston-huntington', name: 'Huntington', active: true, order: 0,
    venue: { lat: 42.339925, lng: -71.088182, address: '360 Huntington Ave' },
};
const SOMERVILLE = {
    id: 'somerville', name: 'Somerville', active: true, order: 1,
    venue: { lat: 42.387, lng: -71.099, address: '5 Elm Street' },
};
let openHalls: Array<typeof HUNTINGTON>;

vi.mock('../../hooks/useRides', () => ({ createRideRequest: (...a: unknown[]) => createRideRequest(...a) }));
vi.mock('../../hooks/useCurrentEvent', () => ({ useCurrentEvent: () => useCurrentEvent() }));
vi.mock('../../hooks/useLocations', () => ({
    useLocations: () => ({ locations: openHalls, active: openHalls, loading: false, error: null }),
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => useSettings(),
    // Real implementation, copied rather than imported: importing the module
    // would pull in firebase/config, which initialises an app at import time.
    formatTime: (value: string) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
        if (!m) return value;
        const h24 = Number(m[1]);
        const suffix = h24 < 12 ? 'AM' : 'PM';
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
        return `${h12}:${m[2]} ${suffix}`;
    },
}));

import { PickupForm } from '../../components/PickupForm';
import { MAX_SEATS } from '../../src/constants/seats';

const rider = {
    id: 'rider-1',
    name: 'Meera Patel',
    address: '42 Oak Street, Edison NJ',
    phone: '+15550001111',
    email: 'meera@example.com',
    role: 'student',
} as never;

/** The stepper's live value — the only tabular-nums number between the two buttons. */
const seatValue = () => screen.getByText((_, el) => {
    if (!el || el.tagName !== 'SPAN') return false;
    return el.getAttribute('aria-live') === 'polite';
}).textContent;

const plus = () => screen.getByRole('button', { name: /one more person/i });
const minus = () => screen.getByRole('button', { name: /one fewer person/i });

const renderForm = (onClose = vi.fn(), onSubmit = vi.fn()) =>
    render(<PickupForm user={rider} onClose={onClose} onSubmit={onSubmit} />);

beforeEach(() => {
    openHalls = [HUNTINGTON];
    useSettings.mockReturnValue({
        sabhaStartTime: '19:00',
        sabhaEndTime: '22:00',
        sabhaLocation: { lat: 40.5, lng: -74.4, address: 'BAPS Mandir, Edison NJ' },
    });
    useCurrentEvent.mockReturnValue({
        event: { startsAt: null, venue: { address: 'BAPS Mandir, Edison NJ' } },
        eventId: '2026-08-14',
        hasEvent: true,
    });
});

describe('PickupForm — the sabha it is filing against', () => {
    it("shows the gathering's own date, not a guessed Friday", () => {
        renderForm();
        // eventId 2026-08-14 is a Friday; formatted from its parts so no
        // timezone shift can move it to the 13th.
        expect(screen.getByText(/Friday, August 14/)).toBeInTheDocument();
    });

    it('shows the start time and venue from the published event', () => {
        renderForm();
        expect(screen.getByText(/Sabha starts at 7:00 PM/)).toBeInTheDocument();
        expect(screen.getByText('BAPS Mandir, Edison NJ')).toBeInTheDocument();
    });

    it("shows the rider's own address as the pickup point", () => {
        renderForm();
        expect(screen.getByText('42 Oak Street, Edison NJ')).toBeInTheDocument();
    });

    it('refuses to submit when no sabha is scheduled, and says so on the button', async () => {
        useCurrentEvent.mockReturnValue({ event: null, eventId: null, hasEvent: false });
        renderForm();

        const button = screen.getByRole('button', { name: /no sabha scheduled yet/i });
        expect(button).toBeDisabled();
        expect(createRideRequest).not.toHaveBeenCalled();
    });
});

describe('PickupForm — the seat stepper', () => {
    it('starts at one person', () => {
        renderForm();
        expect(seatValue()).toBe('1');
    });

    it('counts up and back down', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(plus());
        await user.click(plus());
        expect(seatValue()).toBe('3');

        await user.click(minus());
        expect(seatValue()).toBe('2');
    });

    it('cannot go below one', async () => {
        renderForm();
        expect(minus()).toBeDisabled();
    });

    it('cannot go above the fleet maximum', async () => {
        const user = userEvent.setup();
        renderForm();

        for (let i = 1; i < MAX_SEATS; i++) await user.click(plus());

        expect(seatValue()).toBe(String(MAX_SEATS));
        expect(plus()).toBeDisabled();
    });
});

describe('PickupForm — "Keep us in one car"', () => {
    it('is not offered to a rider travelling alone', () => {
        renderForm();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('appears as soon as a second person is added', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(plus());

        expect(screen.getByRole('checkbox')).toBeInTheDocument();
        expect(screen.getByText(/Keep us in one car/)).toBeInTheDocument();
    });

    it('warns that waiting for one car can take longer', async () => {
        const user = userEvent.setup();
        renderForm();
        await user.click(plus());

        expect(screen.getByText(/it can mean a longer wait/i)).toBeInTheDocument();
    });
});

describe('PickupForm — what it actually files', () => {
    it('books one seat for a rider travelling alone', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        expect(createRideRequest).toHaveBeenCalledTimes(1);
        const [userId, payload] = createRideRequest.mock.calls[0];
        expect(userId).toBe('rider-1');
        expect(payload).toMatchObject({ seats: 1, allowSplit: true, date: '2026-08-14' });
    });

    it('books a seat per person for a family, and allows splitting by default', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(plus());
        await user.click(plus());
        await user.click(plus());
        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        const [, payload] = createRideRequest.mock.calls[0];
        expect(payload.seats).toBe(4);
        // The default is to allow splitting — getting people there beats waiting.
        expect(payload.allowSplit).toBe(true);
    });

    it('turns "keep us together" into allowSplit: false', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(plus());
        await user.click(screen.getByRole('checkbox'));
        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        const [, payload] = createRideRequest.mock.calls[0];
        expect(payload.seats).toBe(2);
        expect(payload.allowSplit).toBe(false);
    });

    it("files against the gathering's id, so the ride belongs to the right sabha", async () => {
        const user = userEvent.setup();
        useCurrentEvent.mockReturnValue({
            event: { startsAt: null, venue: null },
            eventId: '2026-09-04',
            hasEvent: true,
        });
        renderForm();

        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        const [, payload] = createRideRequest.mock.calls[0];
        expect(payload.date).toBe('2026-09-04');
        expect(payload.eventDate).toBe('2026-09-04');
    });

    it('surfaces a failure instead of swallowing it', async () => {
        const user = userEvent.setup();
        createRideRequest.mockRejectedValueOnce(new Error('Requests are closed for this sabha'));
        renderForm();

        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        expect(await screen.findByText('Requests are closed for this sabha')).toBeInTheDocument();
    });
});

describe('PickupForm — confirmation', () => {
    it('confirms the booking, and says how many it was for', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(plus());
        await user.click(plus());
        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        expect(await screen.findByText(/Seva Registered/i)).toBeInTheDocument();
        expect(screen.getByText(/ride for 3 people/i)).toBeInTheDocument();
    });

    it('warns a splittable group at booking time, not at the kerb', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(plus());
        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        expect(await screen.findByText(/we may send two/i)).toBeInTheDocument();
    });

    it('does not threaten a split to a group that asked to stay together', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.click(plus());
        await user.click(screen.getByRole('checkbox'));
        await user.click(screen.getByRole('button', { name: /i want a ride to this sabha/i }));

        await screen.findByText(/Seva Registered/i);
        expect(screen.queryByText(/we may send two/i)).not.toBeInTheDocument();
    });

    it('lets the rider back out without filing anything', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const { container } = renderForm(onClose);

        // The back control is the only button in the form's header bar.
        const back = within(container).getAllByRole('button')[0];
        await user.click(back);

        expect(onClose).toHaveBeenCalled();
        expect(createRideRequest).not.toHaveBeenCalled();
    });
});

/**
 * WHICH SABHA THEY ARE GOING TO.
 *
 * The picker is the rider's half of the never-mix invariant: dispatch refuses a request
 * it cannot place, so a form that did not ask would file requests nobody can serve.
 *
 * THE FIRST ASSERTION IS THAT IT DOES NOT APPEAR. One hall is every evening until a
 * manager opens a second, and a control with one option is a control that cannot do
 * anything — on the longest form a rider fills in.
 */
describe('choosing which sabha', () => {
    const submit = () => screen.getByRole('button', { name: /I want a ride|Choose a sabha/i });

    it('shows NO picker when there is one hall', () => {
        renderForm();
        expect(screen.queryByRole('group', { name: /which sabha/i })).not.toBeInTheDocument();
    });

    it('files against the only hall without asking', async () => {
        renderForm();
        await userEvent.click(submit());

        await waitFor(() => expect(createRideRequest).toHaveBeenCalled());
        // The hall's real id, not null. Explicit beats relying on
        // `createRideRequest`'s fallback — that default is there for a form that
        // cannot name a hall at all, not for the ordinary single-hall case.
        expect(createRideRequest.mock.calls[0][1].locationId).toBe('boston-huntington');
    });

    it('asks once a second hall is open, and names the buildings', () => {
        // A rider is choosing between places, not picking a value from a list.
        openHalls = [HUNTINGTON, SOMERVILLE];
        renderForm();

        expect(screen.getByRole('group', { name: /which sabha/i })).toBeInTheDocument();
        expect(screen.getByText('5 Elm Street')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Huntington/ })).toBeInTheDocument();
    });

    it('WILL NOT SUBMIT until one is picked, and the button says why', async () => {
        // A live button that comes back "please choose which sabha" is worse than one
        // that says what it wants: the picker is above the fold on a long form, so the
        // rider would not know the question existed.
        openHalls = [HUNTINGTON, SOMERVILLE];
        renderForm();

        expect(submit()).toBeDisabled();
        expect(submit()).toHaveTextContent(/Choose a sabha/i);
        expect(createRideRequest).not.toHaveBeenCalled();
    });

    it('files against the hall they picked', async () => {
        openHalls = [HUNTINGTON, SOMERVILLE];
        renderForm();

        await userEvent.click(screen.getByRole('radio', { name: /Somerville/ }));
        expect(submit()).toBeEnabled();
        await userEvent.click(submit());

        await waitFor(() => expect(createRideRequest).toHaveBeenCalled());
        expect(createRideRequest.mock.calls[0][1].locationId).toBe('somerville');
    });

    it('shows that hall\'s address once picked, when the gathering has no override', async () => {
        openHalls = [HUNTINGTON, SOMERVILLE];
        // No per-event venue: the ordinary recurring sabha.
        useCurrentEvent.mockReturnValue({
            event: { startsAt: null, venue: null }, eventId: '2026-08-14', hasEvent: true,
        });
        renderForm();
        await userEvent.click(screen.getByRole('radio', { name: /Somerville/ }));

        // Twice: once in the picker row, once as the venue under "Next Sabha".
        expect(screen.getAllByText('5 Elm Street').length).toBeGreaterThan(1);
    });

    it('but the GATHERING\'S venue still wins over the hall\'s standing one', async () => {
        /**
         * The precedence I had backwards, caught by an existing test rather than a new
         * one. A manager who moves ONE sabha to a church hall writes that on the
         * gathering, and the hall's standing address must not override it. Same order
         * the server uses in `hallContexts`.
         */
        openHalls = [HUNTINGTON, SOMERVILLE];
        renderForm();
        await userEvent.click(screen.getByRole('radio', { name: /Somerville/ }));

        expect(screen.getByText('BAPS Mandir, Edison NJ')).toBeInTheDocument();
    });



});
