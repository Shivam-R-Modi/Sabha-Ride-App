/**
 * The driver's home screen.
 *
 * The defect this replaces is worth restating, because it is the clearest
 * example of the failure mode this repo keeps removing: "Assign Me" was
 * `disabled` whenever no car was chosen, so its click handler never ran, so its
 * `alert('Please select a vehicle first')` was UNREACHABLE CODE. The driver got
 * a grey button and no reason, ever. The first describe block below is entirely
 * about that never coming back.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { DriverShift, type DriverShiftProps } from '../../components/driver/DriverShift';

const vehicles = [
    { id: 'v1', name: 'Grey Odyssey', licensePlate: 'NJ-4821', capacity: 7, color: '#888' },
    { id: 'v2', name: 'Blue Sienna', licensePlate: 'NJ-9001', capacity: 4 },
] as never;

const base: DriverShiftProps = {
    driverName: 'Ramesh Patel',
    onShift: true,
    vehicleName: 'Grey Odyssey',
    vehiclePlate: 'NJ-4821',
    rideContextText: 'Home → Sabha',
    ridesToday: 2, peopleToday: 7, milesToday: 18.4,
    isAssigning: false, isStartingShift: false,
    vehicles, vehiclesLoading: false, vehiclePickerOpen: false, selectingVehicle: false,
    onGoOnShift: vi.fn(), onEndShift: vi.fn(), onFindRiders: vi.fn(),
    onOpenVehiclePicker: vi.fn(), onCloseVehiclePicker: vi.fn(), onSelectVehicle: vi.fn(),
};

const show = (over: Partial<DriverShiftProps> = {}) =>
    render(<DriverShift {...base} {...over} />);

describe('DriverShift — no dead controls', () => {
    it('never renders a disabled primary button when a car is missing', () => {
        show({ vehicleName: undefined, vehiclePlate: undefined });

        const primary = screen.getByRole('button', { name: /pick a car to start/i });
        expect(primary).toBeEnabled();
    });

    it('says what is missing, on the button itself', () => {
        // Not in a tooltip, not in an alert nobody can trigger.
        show({ vehicleName: undefined });
        expect(screen.getByRole('button', { name: /pick a car to start/i })).toBeInTheDocument();
    });

    it('pressing it opens the car picker rather than doing nothing', async () => {
        const user = userEvent.setup();
        const onOpenVehiclePicker = vi.fn();
        show({ vehicleName: undefined, onOpenVehiclePicker });

        await user.click(screen.getByRole('button', { name: /pick a car to start/i }));

        expect(onOpenVehiclePicker).toHaveBeenCalled();
    });

    it('does not try to find riders without a car', async () => {
        const user = userEvent.setup();
        const onFindRiders = vi.fn();
        show({ vehicleName: undefined, onFindRiders });

        await user.click(screen.getByRole('button', { name: /pick a car to start/i }));

        expect(onFindRiders).not.toHaveBeenCalled();
    });
});

describe('DriverShift — off shift', () => {
    it('offers one action', () => {
        show({ onShift: false });
        expect(screen.getByRole('button', { name: /go on shift/i })).toBeInTheDocument();
    });

    it('does not also offer to end a shift that has not started', () => {
        show({ onShift: false });
        expect(screen.queryByRole('button', { name: /end my shift/i })).not.toBeInTheDocument();
    });

    it('shows no second card repeating that you are offline', () => {
        // The old screen rendered an unconditional "No assignments yet" card AND
        // a separate "You are currently offline" card, saying the same thing in
        // different words, one above the other.
        show({ onShift: false });
        expect(screen.queryByText(/no assignments yet/i)).not.toBeInTheDocument();
        expect(screen.getAllByText(/off shift/i)).toHaveLength(1);
    });

    it('does not offer to find riders while off shift', () => {
        show({ onShift: false });
        expect(screen.queryByRole('button', { name: /find my next riders/i })).not.toBeInTheDocument();
    });

    it('starts a shift', async () => {
        const user = userEvent.setup();
        const onGoOnShift = vi.fn();
        show({ onShift: false, onGoOnShift });

        await user.click(screen.getByRole('button', { name: /go on shift/i }));

        expect(onGoOnShift).toHaveBeenCalled();
    });
});

describe('DriverShift — on shift', () => {
    it('shows the car and its plate', () => {
        show();
        expect(screen.getByText('Grey Odyssey')).toBeInTheDocument();
        expect(screen.getByText('NJ-4821')).toBeInTheDocument();
    });

    it('shows which leg is running', () => {
        show();
        expect(screen.getByText('Home → Sabha')).toBeInTheDocument();
    });

    it("keeps today's tally to one quiet line", () => {
        show();
        expect(screen.getByText(/2 runs · 7 people · 18 mi/)).toBeInTheDocument();
    });

    it('gets the singulars right', () => {
        show({ ridesToday: 1, peopleToday: 1 });
        expect(screen.getByText(/1 run · 1 person/)).toBeInTheDocument();
    });

    it('finds riders', async () => {
        const user = userEvent.setup();
        const onFindRiders = vi.fn();
        show({ onFindRiders });

        await user.click(screen.getByRole('button', { name: /find my next riders/i }));

        expect(onFindRiders).toHaveBeenCalled();
    });

    it('cannot be double-tapped while searching', () => {
        show({ isAssigning: true });
        expect(screen.getByRole('button', { name: /finding riders/i })).toBeDisabled();
    });

    it('offers a way off shift', async () => {
        const user = userEvent.setup();
        const onEndShift = vi.fn();
        show({ onEndShift });

        await user.click(screen.getByRole('button', { name: /end my shift/i }));

        expect(onEndShift).toHaveBeenCalled();
    });
});

describe('DriverShift — choosing a car', () => {
    it('is closed until asked for', () => {
        show();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('lists the free cars', () => {
        show({ vehiclePickerOpen: true });
        const dialog = screen.getByRole('dialog', { name: /choose a car/i });
        expect(within(dialog).getByText('Grey Odyssey')).toBeInTheDocument();
        expect(within(dialog).getByText('Blue Sienna')).toBeInTheDocument();
    });

    it('counts PASSENGER seats, not total capacity', () => {
        // A car described as "4 seats" that actually fits three riders is how a
        // family gets left standing on the pavement.
        show({ vehiclePickerOpen: true });
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(/6 passenger seats/)).toBeInTheDocument();
        expect(within(dialog).getByText(/3 passenger seats/)).toBeInTheDocument();
    });

    it('takes a car', async () => {
        const user = userEvent.setup();
        const onSelectVehicle = vi.fn();
        show({ vehiclePickerOpen: true, onSelectVehicle });

        await user.click(screen.getByText('Blue Sienna'));

        expect(onSelectVehicle).toHaveBeenCalledWith(expect.objectContaining({ id: 'v2' }));
    });

    it('says plainly when every car is taken', () => {
        show({ vehiclePickerOpen: true, vehicles: [] });
        expect(screen.getByText(/every car is taken/i)).toBeInTheDocument();
    });

    it('shows a loading state rather than claiming there are none', () => {
        // "Every car is taken" shown before the fleet loads would send a driver
        // home for the evening.
        show({ vehiclePickerOpen: true, vehicles: [], vehiclesLoading: true });
        expect(screen.queryByText(/every car is taken/i)).not.toBeInTheDocument();
        expect(screen.getByText(/looking for free cars/i)).toBeInTheDocument();
    });

    it('cannot be dismissed mid-claim, so a half-finished write is not orphaned', () => {
        show({ vehiclePickerOpen: true, selectingVehicle: true });
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('announces itself as a dialog', () => {
        show({ vehiclePickerOpen: true });
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });
});

describe('the afterShift slot', () => {
    /**
     * This component owns the PAGE — its own `px-4 pt-6` wrapper and the header
     * with the Sarthi's name. So anything DriverDashboard places around it lands
     * either above that header, flush against the app chrome with no title above
     * the fold, or outside the page's own spacing. That is why it is a slot.
     *
     * ITS POSITION IS THE THING WORTH PINNING, not merely that it renders — and
     * the position INVERTED on 2026-08-24. This suite used to assert the slot came
     * BEFORE the shift controls, with a docblock defending it. Two notices
     * carrying flyers then pushed "Go on shift" off the first screen entirely, so
     * the owner's call was core action first, board after. The old assertion is
     * kept in the opposite direction rather than deleted, because "the board
     * outranks the shift button" is a decision that could plausibly be made again
     * by accident.
     */
    it('renders the slot content', () => {
        show({ afterShift: <p>A notice</p> });
        expect(screen.getByText('A notice')).toBeInTheDocument();
    });

    it('renders it AFTER the name, not above it', () => {
        show({ afterShift: <p>A notice</p> });

        const name = screen.getByRole('heading', { name: 'Ramesh Patel' });
        const slot = screen.getByText('A notice');

        // DOCUMENT_POSITION_FOLLOWING === 4
        expect(
            name.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING,
            'the slot must come after the page header, or the screen opens with no title',
        ).toBeTruthy();
    });

    it('renders it AFTER the shift controls', () => {
        show({ afterShift: <p>A notice</p> });

        const slot = screen.getByText('A notice');
        const action = screen.getByRole('button', { name: /find my next riders/i });

        expect(
            action.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING,
            'the shift control must come first, or the board buries what this page is for',
        ).toBeTruthy();
    });

    it('renders it after the end-shift control too', () => {
        // The whole shift GROUP comes first, not just the primary button. On shift
        // there are two controls, and squeezing the board between them would put a
        // wall of notices in the middle of one decision.
        show({ afterShift: <p>A notice</p> });

        const end = screen.getByRole('button', { name: /end my shift/i });
        const slot = screen.getByText('A notice');

        expect(end.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('changes nothing when omitted', () => {
        // Every other caller passes no slot; the screen must be untouched.
        const { container } = show();
        expect(container.textContent).toContain('Ramesh Patel');
        expect(screen.getByRole('button', { name: /find my next riders/i })).toBeInTheDocument();
    });
});

/**
 * WHICH SABHA THIS RUN IS FOR.
 *
 * A Sarthi picks per RUN rather than being tied to a hall for the evening, so the
 * choice lives beside the button that starts a run.
 *
 * THE FIRST TWO CASES ARE THAT NOTHING APPEARS. One hall is every evening until a
 * manager opens a second, and a picker with one option is exactly the dead control the
 * first describe block in this file exists to police.
 */
describe('DriverShift — which sabha', () => {
    const HALLS = [
        { id: 'boston-huntington', name: 'Huntington' },
        { id: 'somerville', name: 'Somerville' },
    ];
    const primary = () => screen.getByRole('button', { name: /Find|Choose a sabha|Pick a car/i });

    it('shows no picker with one hall', () => {
        show({ halls: [HALLS[0]], hallId: 'boston-huntington' });
        expect(screen.queryByRole('group', { name: /driving for/i })).not.toBeInTheDocument();
    });

    it('shows no picker with none passed, which is what every existing caller does', () => {
        show();
        expect(screen.queryByRole('group', { name: /driving for/i })).not.toBeInTheDocument();
        expect(primary()).toHaveTextContent(/Find my next riders/i);
    });

    it('offers both once a second hall is open', () => {
        show({ halls: HALLS, hallId: null });
        expect(screen.getByRole('group', { name: /driving for/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Huntington' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Somerville' })).toBeInTheDocument();
    });

    it('marks the chosen one as pressed, for a screen reader', () => {
        show({ halls: HALLS, hallId: 'somerville' });
        expect(screen.getByRole('button', { name: 'Somerville' }))
            .toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Huntington' }))
            .toHaveAttribute('aria-pressed', 'false');
    });

    it('reports a pick', async () => {
        const onPickHall = vi.fn();
        show({ halls: HALLS, hallId: null, onPickHall });

        await userEvent.click(screen.getByRole('button', { name: 'Somerville' }));
        expect(onPickHall).toHaveBeenCalledWith('somerville');
    });

    it('NAMES THE HALL on the button, so a carried-forward choice is visible', () => {
        /**
         * "Find my next riders" after a completed run keeps the previous hall. That is
         * the right behaviour and it is invisible unless the button says so — a Sarthi
         * should not have to remember which hall they were driving for.
         */
        show({ halls: HALLS, hallId: 'somerville' });
        expect(primary()).toHaveTextContent(/Find riders for Somerville/i);
    });

    it('will not start a run until a hall is picked, and says which is missing', () => {
        show({ halls: HALLS, hallId: null });

        expect(primary()).toBeDisabled();
        expect(primary()).toHaveTextContent(/Choose a sabha above/i);
    });

    it('still says "Pick a car to start" when there is no car, hall or no hall', () => {
        // The rule the first describe block polices: never a disabled primary button
        // for want of a CAR. A missing hall must not take that over.
        show({ halls: HALLS, hallId: null, vehicleName: undefined, vehiclePlate: undefined });

        expect(primary()).toBeEnabled();
        expect(primary()).toHaveTextContent(/Pick a car to start/i);
    });
});
